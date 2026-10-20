import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runShopper, type ShopperStep } from "../shopper/shopper.js";
import { judge, type Evidence, type Verdict } from "./checks.js";
import { moneyForOrder } from "./paypalDirect.js";
import type { PayPalProxy, ProxyLogEntry } from "./proxy.js";
import { HELD_FOR_MS, type Scenario } from "./scenarios.js";
import type { StoreOrder } from "./storeProfile.js";

export const STORE_TIMEOUT_MS = 4_000;

// A store under test: a folder whose app.ts exports createStoreApp.
export interface StoreUnderTest { label: string; dir: string }

export type RunEvent =
  | { type: "started"; scenario: string; store: string }
  | { type: "step"; step: ShopperStep }
  | { type: "frame"; jpeg: string }
  | { type: "paypal"; entry: ProxyLogEntry }
  | { type: "checking" }
  | { type: "verdict"; verdict: Verdict };

export interface RunResult {
  scenario: string;
  store: string;
  dir: string;
  evidence: Evidence;
  verdict: Verdict;
  proxyLog: ProxyLogEntry[];
  videoPath?: string;
}

const STORE_HOST = fileURLToPath(new URL("./storeHost.ts", import.meta.url));

// Starts the store in its own process so its code is read fresh from disk.
function startStore(dir: string, apiBase: string): Promise<{ port: number; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", STORE_HOST, dir, apiBase, String(STORE_TIMEOUT_MS)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d; process.stderr.write(d); });
    child.stdout.once("data", (d: Buffer) => {
      try {
        resolve({ port: JSON.parse(d.toString().split("\n")[0]).port, stop: () => child.kill() });
      } catch {
        reject(new Error(`The store didn't start: ${d}`));
      }
    });
    child.once("exit", (code) => reject(new Error(`The store exited before starting (code ${code}): ${stderr.slice(-500)}`)));
  });
}

// Runs one scenario against one store and judges the money.
export async function runScenario(opts: {
  scenario: Scenario;
  store: StoreUnderTest;
  proxy: PayPalProxy;
  runDir: string;
  onEvent?: (event: RunEvent) => void;
}): Promise<RunResult> {
  const { scenario, store: target, proxy } = opts;
  const emit = opts.onEvent ?? (() => {});
  emit({ type: "started", scenario: scenario.id, store: target.label });

  proxy.reset();
  proxy.setRules(scenario.faults);
  const unsubscribe = proxy.onEntry((entry) => emit({ type: "paypal", entry }));

  const host = await startStore(target.dir, proxy.url);
  const storeUrl = `http://localhost:${host.port}`;
  const dir = join(opts.runDir, scenario.id, target.label);
  mkdirSync(dir, { recursive: true });

  try {
    const shopper = await runShopper({
      storeUrl,
      persona: scenario.persona,
      behaviour: scenario.behaviour,
      videoDir: dir,
      maxSteps: scenario.maxSteps,
      onStep: (step) => emit({ type: "step", step }),
      onFrame: opts.onEvent ? (jpeg) => emit({ type: "frame", jpeg }) : undefined,
    });
    // Let any held PayPal answer land before reading the books.
    if (scenario.faults.some((f) => f.action === "delay-response")) await new Promise((r) => setTimeout(r, HELD_FOR_MS));

    emit({ type: "checking" });
    const orderIds = new Set<string>();
    for (const entry of proxy.log) {
      if (entry.method === "POST" && entry.path === "/v2/checkout/orders" && entry.summary?.orderId) orderIds.add(entry.summary.orderId);
    }
    if (shopper.orderId) orderIds.add(shopper.orderId);

    const orders = await Promise.all(
      [...orderIds].map(async (orderId) => ({
        orderId,
        money: await moneyForOrder(orderId).catch(() => undefined),
        // What the shop believes, asked over its own API like any other client.
        storeOrder: await fetch(`${storeUrl}/api/orders/${orderId}`)
          .then((r) => (r.ok ? (r.json() as Promise<StoreOrder>) : undefined))
          .catch(() => undefined),
      })),
    );
    const evidence: Evidence = { shopper, orders };
    const verdict = judge(scenario, evidence);
    emit({ type: "verdict", verdict });

    const result: RunResult = { scenario: scenario.id, store: target.label, dir, evidence, verdict, proxyLog: [...proxy.log], videoPath: shopper.videoPath };
    writeFileSync(join(dir, "report.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    unsubscribe();
    host.stop();
  }
}
