import { join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fromCents } from "../lab/storeProfile.js";
import type { Lab, LabRun, Lane } from "../server/lab.js";

// DummyRun as tools for coding agents (Claude Code, Cursor, Codex...).
// The loop it enables: "crash-test my checkout" -> "fix it" -> "run it again",
// without leaving the editor. Locally the lab tests the store folder in the
// developer's working copy, so a fix the agent saves is what the re-run tests.

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ ...text(message), isError: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function laneSummary(l: Lane) {
  const v = l.result?.verdict;
  return {
    scenario: l.scenario,
    status: l.status,
    ...(v?.inconclusive ? { inconclusive: v.inconclusive } : {}),
    ...(v && !v.inconclusive
      ? {
          safety_rating: `${v.rating}/5`,
          money_at_risk_usd: fromCents(v.atRiskCents),
          failed_checks: v.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
        }
      : {}),
  };
}

function runSummary(run: LabRun, watchUrl: string) {
  const judged = run.lanes.filter((l) => l.result && !l.result.verdict.inconclusive);
  return {
    run_id: run.id,
    store: run.store === "original" ? "the store in your working copy" : "the hand-fixed reference store",
    status: run.finishedAt ? "finished" : "running",
    watch_url: watchUrl,
    ...(judged.length
      ? {
          safety_rating: `${Math.min(...judged.map((l) => l.result!.verdict.rating))}/5 (weakest test)`,
          total_money_at_risk_usd: fromCents(judged.reduce((s, l) => s + l.result!.verdict.atRiskCents, 0)),
        }
      : {}),
    tests: run.lanes.map(laneSummary),
  };
}

export function createMcpServer(lab: Lab, baseUrl: string) {
  const server = new McpServer({ name: "dummyrun", version: "0.1.0" });
  const watch = (id: string) => `${baseUrl}/?run=${encodeURIComponent(id)}`;
  const findLane = (runId: string, scenario: string) => lab.get(runId)?.lanes.find((l) => l.scenario === scenario);

  server.registerTool(
    "list_scenarios",
    { title: "List crash-test scenarios", description: "The failures DummyRun can throw at a PayPal checkout, with the AI test shopper used for each." },
    async () => text(lab.scenarios()),
  );

  server.registerTool(
    "start_crash_test",
    {
      title: "Start a crash test",
      description:
        "Send AI test shoppers through the store's real PayPal sandbox checkout while DummyRun injects failures, then check every charge and refund in PayPal's own records. " +
        "Returns at once with a run_id and a link to watch live; call get_crash_test to wait for the results. A full run takes a few minutes.",
      inputSchema: {
        scenarios: z.array(z.string()).optional().describe("Scenario ids from list_scenarios. Omit to run them all."),
        store: z.enum(["original", "fixed"]).optional().describe("'original' (default) is the store in the working copy; 'fixed' is the hand-fixed reference."),
      },
    },
    async ({ scenarios, store }) => {
      try {
        const run = lab.start(store ?? "original", scenarios);
        return text({ run_id: run.id, watch_url: watch(run.id), next: "Call get_crash_test with this run_id and wait_seconds to get the results." });
      } catch (error) {
        return fail((error as Error).message);
      }
    },
  );

  server.registerTool(
    "get_crash_test",
    {
      title: "Get crash-test results",
      description: "Status and money results of a crash test. Waits up to wait_seconds for it to finish.",
      inputSchema: {
        run_id: z.string(),
        wait_seconds: z.number().min(0).max(50).optional().describe("How long to wait for the run to finish, up to 50 seconds."),
      },
    },
    async ({ run_id, wait_seconds }) => {
      const deadline = Date.now() + (wait_seconds ?? 0) * 1000;
      let run = lab.get(run_id);
      if (!run) return fail(`No crash test with id ${run_id}`);
      while (!run.finishedAt && Date.now() < deadline) {
        await sleep(1000);
        run = lab.get(run_id)!;
      }
      return text(runSummary(run, watch(run_id)));
    },
  );

  server.registerTool(
    "get_test_evidence",
    {
      title: "Get the evidence for one test",
      description: "For one scenario in a crash test: failed money checks, money at risk, every PayPal call with any injected fault, and what the AI shopper did and saw.",
      inputSchema: { run_id: z.string(), scenario: z.string() },
    },
    async ({ run_id, scenario }) => {
      const lane = findLane(run_id, scenario);
      if (!lane?.result) return fail("That test hasn't finished.");
      const { verdict, proxyLog, evidence } = lane.result;
      return text({
        ...laneSummary(lane),
        money_at_risk: verdict.atRisk.map((r) => ({ reason: r.reason, usd: fromCents(r.cents) })),
        paypal_calls: proxyLog
          .filter((e) => !e.path.includes("oauth2"))
          .map((e) => ({ call: `${e.method} ${e.path}`, status: e.status, paypal_request_id: e.requestId ?? null, injected_fault: e.fault ?? null, result: e.summary ?? null })),
        shopper_steps: evidence.shopper.steps.map((s) => ({ action: s.tool, args: s.args, shop_said: s.result.slice(0, 240) })),
      });
    },
  );

  server.registerTool(
    "diagnose_failure",
    {
      title: "Diagnose a failure and propose the fix",
      description:
        "DummyRun's investigator reads the test's evidence and the store's source and returns a plain-English explanation, the exact location and code edits. " +
        "Nothing is changed. Apply each edit to the named file (its 'find' text appears exactly once), then run start_crash_test again to verify.",
      inputSchema: { run_id: z.string(), scenario: z.string() },
    },
    async ({ run_id, scenario }) => {
      try {
        const { diagnosis, storeDir } = await lab.diagnose(run_id, scenario);
        const path = (file: string) => relative(process.cwd(), join(storeDir, file)).replaceAll("\\", "/");
        return text({
          explanation: diagnosis.explanation,
          where: `${path(diagnosis.rootCause.file)}:${diagnosis.rootCause.line}`,
          fix: diagnosis.fix.summary,
          paypal_guidance: diagnosis.paypalGuidance,
          edits: diagnosis.fix.edits.map((e) => ({ file: path(e.file), find: e.find, replace: e.replace })),
          next: "Apply the edits, then call start_crash_test with the same scenario to verify the fix against PayPal's sandbox.",
        });
      } catch (error) {
        return fail((error as Error).message);
      }
    },
  );

  server.registerTool(
    "verify_fix_in_copy",
    {
      title: "Verify the fix on a copy",
      description:
        "Apply the investigator's fix to a copy of the store and re-run the same scenario, without touching the working copy. Useful on the hosted demo. Waits up to wait_seconds.",
      inputSchema: { run_id: z.string(), scenario: z.string(), wait_seconds: z.number().min(0).max(50).optional() },
    },
    async ({ run_id, scenario, wait_seconds }) => {
      const lane = findLane(run_id, scenario);
      if (!lane?.result) return fail("That test hasn't finished.");
      if (!lane.fix || lane.fix.status === "failed") void lab.fix(run_id, scenario);
      const deadline = Date.now() + (wait_seconds ?? 50) * 1000;
      while (Date.now() < deadline && !["done", "failed"].includes(findLane(run_id, scenario)?.fix?.status ?? "")) await sleep(1000);
      const fix = findLane(run_id, scenario)!.fix!;
      return text({
        status: fix.status,
        ...(fix.message ? { message: fix.message } : {}),
        ...(fix.after
          ? {
              before: { safety_rating: `${lane.result.verdict.rating}/5`, money_at_risk_usd: fromCents(lane.result.verdict.atRiskCents) },
              after: { safety_rating: `${fix.after.verdict.rating}/5`, money_at_risk_usd: fromCents(fix.after.verdict.atRiskCents) },
            }
          : { next: "Still working. Call verify_fix_in_copy again to keep waiting." }),
        watch_url: watch(run_id),
      });
    },
  );

  return server;
}
