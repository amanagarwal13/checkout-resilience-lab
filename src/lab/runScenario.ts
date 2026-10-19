import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { config } from "../config.js";
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

interface StoreModule {
  createStoreApp(options: {
    paypal: { clientId: string; clientSecret: string; apiBase?: string };
    openai: { apiKey: string; model: string };
    refundTimeoutMs?: number;
  }): { app: Hono; orders: Map<string, StoreOrder> };
}

// Runs one scenario against one store and judges the money.
export async function runScenario(opts: {
  scenario: Scenario;
  store: StoreUnderTest;
  proxy: PayPalProxy;
  port?: number; // 0 or omitted: any free port
  runDir: string;
  onEvent?: (event: RunEvent) => void;
}): Promise<RunResult> {
  const { scenario, store: target, proxy, port } = opts;
  const emit = opts.onEvent ?? (() => {});
  emit({ type: "started", scenario: scenario.id, store: target.label });

  proxy.reset();
  proxy.setRules(scenario.faults);
  const unsubscribe = proxy.onEntry((entry) => emit({ type: "paypal", entry }));

  const { createStoreApp } = (await import(pathToFileURL(join(target.dir, "app.ts")).href)) as StoreModule;
  const store = createStoreApp({
    refundTimeoutMs: STORE_TIMEOUT_MS,
    paypal: { clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, apiBase: proxy.url },
    openai: { apiKey: config.openaiApiKey, model: config.openaiModel },
  });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: store.app.fetch, port: port ?? 0 }, () => resolve(s));
  });
  const storePort = (server.address() as AddressInfo).port;
  const dir = join(opts.runDir, scenario.id, target.label);
  mkdirSync(dir, { recursive: true });

  try {
    const shopper = await runShopper({
      storeUrl: `http://localhost:${storePort}`,
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
        storeOrder: store.orders.get(orderId),
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
    server.close();
  }
}
