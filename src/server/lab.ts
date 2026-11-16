import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, copyStore, typecheck } from "../investigator/fixer.js";
import { investigate, type Diagnosis } from "../investigator/investigator.js";
import { createPayPalProxy } from "../lab/proxy.js";
import { runScenario, type RunEvent, type RunResult, type StoreUnderTest } from "../lab/runScenario.js";
import { findScenario, scenarios } from "../lab/scenarios.js";
import { storeBuilds } from "../lab/storeProfile.js";

export type StoreLabel = "original" | "fixed";

export interface FixState {
  status: "investigating" | "patching" | "compiling" | "rerunning" | "done" | "failed";
  message?: string;
  diagnosis?: Diagnosis;
  after?: RunResult;
}

export interface Lane {
  scenario: string;
  status: "queued" | "running" | "checking" | "done" | "error";
  error?: string;
  steps: RunResult["evidence"]["shopper"]["steps"];
  paypal: RunResult["proxyLog"];
  result?: RunResult;
  fix?: FixState;
  // The investigator's diagnosis on its own, for a coding agent to apply to the developer's files.
  diagnosis?: Diagnosis;
}

export interface LabRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  store: StoreLabel;
  lanes: Lane[];
}

export type LabEvent =
  | { lane: string; event: RunEvent }
  | { lane: string; laneUpdate: Lane }
  | { lane: string; fixEvent: RunEvent }
  | { run: "finished" };

const RUNS_DIR = "runs";
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL ?? 3);

// Runs stress tests for the web interface and keeps the history.
export function createLab() {
  const runs = new Map<string, LabRun>();
  const listeners = new Map<string, Set<(e: LabEvent) => void>>();
  const latestFrame = new Map<string, string>(); // `${runId}/${lane}` -> jpeg
  let active: string | undefined;

  for (const id of existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : []) {
    const file = join(RUNS_DIR, id, "run.json");
    if (existsSync(file)) runs.set(id, JSON.parse(readFileSync(file, "utf8")));
  }

  function emit(runId: string, event: LabEvent) {
    for (const listener of listeners.get(runId) ?? []) listener(event);
  }

  // Finished tests keep their last frame on disk so the lane still has a picture later.
  function keepLastFrame(runId: string, laneId: string, dir: string) {
    const jpeg = latestFrame.get(`${runId}/${laneId}`);
    if (jpeg) writeFileSync(join(dir, "last-frame.jpg"), Buffer.from(jpeg, "base64"));
  }

  function frameFromDisk(runId: string, laneId: string) {
    const lane = runs.get(runId)?.lanes.find((l) => l.scenario === laneId);
    const dir = lane?.fix?.after?.dir ?? lane?.result?.dir;
    const file = dir && join(dir, "last-frame.jpg");
    return file && existsSync(file) ? readFileSync(file).toString("base64") : undefined;
  }

  function save(run: LabRun) {
    mkdirSync(join(RUNS_DIR, run.id), { recursive: true });
    writeFileSync(join(RUNS_DIR, run.id, "run.json"), JSON.stringify(run, null, 2));
  }

  async function runLane(run: LabRun, lane: Lane, target: StoreUnderTest, onEvent: (e: RunEvent) => void) {
    const scenario = findScenario(lane.scenario)!;
    const proxy = createPayPalProxy({ port: 0 });
    await proxy.listen();
    try {
      return await runScenario({ scenario, store: target, proxy, runDir: join(RUNS_DIR, run.id), onEvent });
    } finally {
      await proxy.close();
    }
  }

  async function execute(run: LabRun) {
    const queue = [...run.lanes];
    const target: StoreUnderTest = { label: run.store, dir: storeBuilds[run.store] };
    async function worker() {
      for (let lane = queue.shift(); lane; lane = queue.shift()) {
        lane.status = "running";
        emit(run.id, { lane: lane.scenario, laneUpdate: lane });
        try {
          lane.result = await runLane(run, lane, target, (event) => {
            if (event.type === "frame") latestFrame.set(`${run.id}/${lane!.scenario}`, event.jpeg);
            if (event.type === "step") lane!.steps.push(event.step);
            if (event.type === "paypal") lane!.paypal.push(event.entry);
            if (event.type === "checking") lane!.status = "checking";
            emit(run.id, { lane: lane!.scenario, event });
          });
          lane.status = "done";
          keepLastFrame(run.id, lane.scenario, lane.result.dir);
        } catch (error) {
          lane.status = "error";
          lane.error = error instanceof Error ? error.message : String(error);
        }
        emit(run.id, { lane: lane.scenario, laneUpdate: lane });
        save(run);
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, run.lanes.length) }, worker));
    run.finishedAt = new Date().toISOString();
    save(run);
    active = undefined;
    emit(run.id, { run: "finished" });
  }

  return {
    scenarios: () => scenarios.map((s) => ({ id: s.id, title: s.title, summary: s.summary, persona: s.persona.name })),
    list: () => [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    get: (id: string) => runs.get(id),
    frame: (id: string, lane: string) => latestFrame.get(`${id}/${lane}`) ?? frameFromDisk(id, lane),
    isBusy: () => Boolean(active),

    start(store: StoreLabel, scenarioIds?: string[]): LabRun {
      if (active) throw new Error("A stress test is already running. Wait for it to finish.");
      const picked = scenarioIds?.length ? scenarios.filter((s) => scenarioIds.includes(s.id)) : scenarios;
      const run: LabRun = {
        id: new Date().toISOString().replace(/[:.]/g, "-"),
        startedAt: new Date().toISOString(),
        store,
        lanes: picked.map((s) => ({ scenario: s.id, status: "queued", steps: [], paypal: [] })),
      };
      runs.set(run.id, run);
      active = run.id;
      save(run);
      void execute(run);
      return run;
    },

    // Investigate a failed lane and return the fix without applying it anywhere.
    async diagnose(runId: string, laneId: string): Promise<{ diagnosis: Diagnosis; storeDir: string }> {
      const run = runs.get(runId);
      const lane = run?.lanes.find((l) => l.scenario === laneId);
      const scenario = findScenario(laneId);
      if (!run || !lane?.result || !scenario) throw new Error("That test hasn't finished.");
      const storeDir = storeBuilds[run.store];
      lane.diagnosis ??= await investigate(scenario, lane.result, storeDir);
      save(run);
      return { diagnosis: lane.diagnosis, storeDir };
    },

    // Investigate a failed lane, patch a copy of the store and re-run it.
    async fix(runId: string, laneId: string) {
      const run = runs.get(runId);
      const lane = run?.lanes.find((l) => l.scenario === laneId);
      const scenario = findScenario(laneId);
      if (!run || !lane?.result || !scenario) throw new Error("That test hasn't finished.");
      if (run.store !== "original") throw new Error("Fixes are written for the original store.");
      if (lane.fix && !["done", "failed"].includes(lane.fix.status)) throw new Error("A fix is already in progress.");

      const update = (fix: FixState) => {
        lane.fix = fix;
        emit(runId, { lane: laneId, laneUpdate: lane });
        save(run);
      };
      try {
        update({ status: "investigating" });
        const diagnosis = await investigate(scenario, lane.result, storeBuilds.original);
        update({ status: "patching", diagnosis });
        const patchedDir = join(RUNS_DIR, runId, laneId, "patched-store");
        copyStore(storeBuilds.original, patchedDir);
        applyEdits(patchedDir, diagnosis.fix.edits);
        update({ status: "compiling", diagnosis });
        const compiled = await typecheck(patchedDir);
        if (!compiled.ok) return update({ status: "failed", diagnosis, message: `The fix doesn't compile:\n${compiled.output}` });
        update({ status: "rerunning", diagnosis });
        const proxy = createPayPalProxy({ port: 0 });
        await proxy.listen();
        try {
          const after = await runScenario({
            scenario,
            store: { label: "patched", dir: patchedDir },
            proxy,
            runDir: join(RUNS_DIR, runId),
            onEvent: (event) => {
              if (event.type === "frame") latestFrame.set(`${runId}/${laneId}`, event.jpeg);
              emit(runId, { lane: laneId, fixEvent: event });
            },
          });
          keepLastFrame(runId, laneId, after.dir);
          update({ status: "done", diagnosis, after });
        } finally {
          await proxy.close();
        }
      } catch (error) {
        update({ status: "failed", diagnosis: lane.fix?.diagnosis, message: error instanceof Error ? error.message : String(error) });
      }
    },

    subscribe(runId: string, listener: (e: LabEvent) => void) {
      if (!listeners.has(runId)) listeners.set(runId, new Set());
      listeners.get(runId)!.add(listener);
      return () => listeners.get(runId)?.delete(listener);
    },
  };
}

export type Lab = ReturnType<typeof createLab>;
