import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chromium, type Page } from "playwright";
import { config } from "../config.js";
import { fillCardField, TEST_CARD } from "../shopper/browserTools.js";
import { moneyForOrder } from "./paypalDirect.js";
import { createPayPalProxy, type FaultRule, type PayPalProxy } from "./proxy.js";
import { HELD_FOR_MS } from "./scenarios.js";
import { fromCents, toCents } from "./storeProfile.js";

// Crash-tests a store DummyRun didn't write: PayPal's own advanced-integration
// example (paypal-examples/docs-examples, advanced-integration/v2, Apache-2.0),
// run as published apart from the two DummyRun lines in server.js.
// Its page has no product list or order pages, so the shopper here is scripted
// (same card entry as the AI shoppers) rather than an AI agent.
// Usage: npm run crash:paypal-example [-- baseline|double-pay|slow-capture|declined-card] [--fixed]

const FIXED = process.argv.includes("--fixed");
const STORE_DIR = resolve(FIXED ? "stores/paypal-advanced-example-fixed" : "stores/paypal-advanced-example");
const forwardErrors: string[] = [];

interface ExampleScenario {
  id: string;
  title: string;
  faults: FaultRule[];
  expectedCharges: number;
  shopper: (page: Page) => Promise<void>;
  extraCheck?: (told: string) => { name: string; passed: boolean; detail: string };
}

const payButton = "#card-field-submit-button";
const result = "#result-message";
// The page's own billing-address fields (PayPal requires the country).
const ADDRESS = { "line-1": "1 Main St", "admin-area-line-1": "CA", "admin-area-line-2": "San Jose", "country-code": "US", "postal-code": "95131" };
const resultText = (page: Page) => page.textContent(result).then((t) => t?.trim() ?? "");

const scenarios: ExampleScenario[] = [
  {
    id: "baseline",
    title: "Control: one normal purchase, no faults",
    faults: [],
    expectedCharges: 1,
    shopper: async (page) => {
      await page.click(payButton);
    },
  },
  {
    id: "double-pay",
    title: "Impatient shopper double-clicks Pay",
    faults: [],
    expectedCharges: 1,
    shopper: async (page) => {
      await page.click(payButton);
      await page.waitForTimeout(150);
      await page.click(payButton, { force: true, timeout: 2_000 }).catch(() => {});
    },
  },
  {
    id: "slow-capture",
    title: "PayPal is slow to answer the capture, so the shopper presses Pay again",
    faults: [{ name: "slow capture", method: "POST", path: /\/v2\/checkout\/orders\/[^/]+\/capture$/, action: "delay-response", delayMs: HELD_FOR_MS, times: 1 }],
    expectedCharges: 1,
    shopper: async (page) => {
      await page.click(payButton);
      await page.waitForTimeout(4_000);
      if (!(await resultText(page))) await page.click(payButton, { force: true, timeout: 2_000 }).catch(() => {});
    },
  },
  {
    id: "declined-card",
    title: "Card declined at capture",
    faults: [{ name: "card declined", method: "POST", path: /\/v2\/checkout\/orders\/[^/]+\/capture$/, action: "mock-response", mockCode: "INSTRUMENT_DECLINED", times: 1 }],
    expectedCharges: 0,
    shopper: async (page) => {
      await page.click(payButton);
    },
    extraCheck: (told) => ({ name: "Shopper is told the card was declined", passed: /declined/i.test(told), detail: `page said: "${told.slice(0, 160)}"` }),
  },
];

// One request on its own connection (no keep-alive, no retry).
function forward(port: number, method: string, path: string, body?: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "localhost", port, method, path, agent: false, headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.setEncoding("utf8").on("data", (d) => (data += d)).on("end", () => ok({ status: res.statusCode ?? 502, type: res.headers["content-type"] ?? "application/json", body: data }));
    });
    req.on("error", fail).end(body);
  });
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    }).on("error", fail);
  });
}

// PayPal's server as published, plus the page their Vite setup would serve:
// index.html with the client ID filled in, app.js, and /api forwarded to the server.
async function startExample(apiBase: string, logFile: string) {
  const apiPort = await freePort();
  const log = createWriteStream(logFile);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: STORE_DIR,
    env: { ...process.env, PORT: String(apiPort), PAYPAL_CLIENT_ID: config.paypalClientId, PAYPAL_CLIENT_SECRET: config.paypalClientSecret, DUMMYRUN_PAYPAL_API: apiBase },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  await new Promise<void>((ok, fail) => {
    server.stdout.on("data", (d: Buffer) => d.toString().includes("listening") && ok());
    server.once("exit", (code) => fail(new Error(`PayPal's example server exited (code ${code}); see ${logFile}`)));
  });

  const page = readFileSync(join(STORE_DIR, "client/index.html"), "utf8").replaceAll("%PAYPAL_CLIENT_ID%", config.paypalClientId);
  const app = new Hono();
  app.get("/", (c) => c.html(page));
  app.get("/app.js", (c) => c.body(readFileSync(join(STORE_DIR, "client/app.js"), "utf8"), 200, { "Content-Type": "text/javascript" }));
  // Forwards like Vite's dev proxy, one connection per request and never retried,
  // so every payment request the page makes reaches PayPal's server exactly once.
  app.all("/api/*", async (c) => {
    const path = new URL(c.req.url).pathname;
    try {
      const { status, type, body } = await forward(apiPort, c.req.method, path, c.req.method === "GET" ? undefined : await c.req.text());
      return c.body(body, status as 200, { "Content-Type": type });
    } catch (error) {
      forwardErrors.push(`${c.req.method} ${path}: ${(error as Error).cause ?? error}`);
      return c.json({ error: "DummyRun couldn't reach the store" }, 502);
    }
  });
  const front = await new Promise<ReturnType<typeof serve>>((ok) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => ok(s));
  });
  const url = `http://localhost:${(front.address() as AddressInfo).port}`;
  return { url, stop: () => { front.close(); server.kill(); log.end(); } };
}

async function run(scenario: ExampleScenario, proxy: PayPalProxy, dir: string) {
  mkdirSync(dir, { recursive: true });
  proxy.reset();
  proxy.setRules(scenario.faults);
  const store = await startExample(proxy.url, join(dir, "store.log"));
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const viewport = { width: 1100, height: 900 };
  const context = await browser.newContext({ viewport, recordVideo: { dir, size: viewport } });
  const page = await context.newPage();
  let told = "";
  let problem: string | undefined;
  try {
    await page.goto(store.url, { waitUntil: "domcontentloaded" });
    for (const [kind, value] of [["name", TEST_CARD.name], ["number", TEST_CARD.number], ["expiry", TEST_CARD.expiry], ["cvv", TEST_CARD.cvv]] as const) {
      await fillCardField(page, kind, value);
    }
    for (const [field, value] of Object.entries(ADDRESS)) await page.fill(`#card-billing-address-${field}`, value);
    await scenario.shopper(page);
    await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? "").trim() !== "", result, { timeout: 60_000 }).catch(() => {});
    if (scenario.faults.some((f) => f.action === "delay-response")) await page.waitForTimeout(HELD_FOR_MS);
    told = (await resultText(page)).replace(/\s+/g, " ");
  } catch (error) {
    problem = (error as Error).message;
  } finally {
    await context.close();
    await browser.close();
    store.stop();
  }

  const orderIds = [...new Set(proxy.log.filter((e) => e.method === "POST" && e.path === "/v2/checkout/orders" && e.summary?.orderId).map((e) => e.summary!.orderId))];
  const orders = await Promise.all(orderIds.map(async (id) => ({ id, money: await moneyForOrder(id).catch(() => undefined) })));
  const charges = orders.flatMap((o) => (o.money?.captures ?? []).filter((c) => c.status === "COMPLETED").map((c) => ({ order: o.id, cents: toCents(c.amount) })));
  const checks = [
    { name: "One cart, one charge", passed: charges.length === scenario.expectedCharges, detail: `expected ${scenario.expectedCharges} charge(s), PayPal shows ${charges.length}${charges.length ? `: ${charges.map((c) => `$${fromCents(c.cents)} (order ${c.order})`).join(", ")}` : ""}` },
    ...(scenario.extraCheck ? [scenario.extraCheck(told)] : []),
  ];
  const atRiskCents = charges.slice(scenario.expectedCharges).reduce((s, c) => s + c.cents, 0);
  const passed = checks.filter((c) => c.passed).length;
  const base = Math.max(1, Math.round((5 * passed) / checks.length));
  const verdict = {
    scenario: scenario.id,
    inconclusive: !proxy.log.some((e) => e.path.endsWith("/capture")) && scenario.expectedCharges > 0 ? `The test shopper never got as far as paying (${problem ?? told.slice(0, 200)})` : undefined,
    told,
    checks,
    atRiskCents,
    rating: atRiskCents > 0 ? Math.min(base, 2) : base,
    paypalCalls: proxy.log.filter((e) => !e.path.includes("oauth2")).map((e) => ({ call: `${e.method} ${e.path}`, status: e.status, requestId: e.requestId ?? null, fault: e.fault ?? null })),
  };
  writeFileSync(join(dir, "report.json"), JSON.stringify(verdict, null, 2));
  return verdict;
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const picked = wanted.length ? scenarios.filter((s) => wanted.includes(s.id)) : scenarios;
const runDir = join("runs", FIXED ? "paypal-example-fixed" : "paypal-example", new Date().toISOString().replace(/[:.]/g, "-"));
const proxy = createPayPalProxy({ port: 0 });
await proxy.listen();
console.log(`Crash-testing PayPal's advanced-integration example${FIXED ? " with the DummyRun fixes" : " as published"}. Recordings in ${runDir}\n`);
try {
  for (const scenario of picked) {
    const v = await run(scenario, proxy, join(runDir, scenario.id));
    console.log(`${scenario.title}`);
    if (v.inconclusive) console.log(`  inconclusive: ${v.inconclusive}`);
    else console.log(`  ${v.rating}/5, $${fromCents(v.atRiskCents)} at risk`);
    for (const c of v.checks) console.log(`  ${c.passed ? "pass" : "FAIL"} ${c.name}: ${c.detail}`);
    for (const call of v.paypalCalls) console.log(`    ${call.call} -> ${call.status}${call.requestId ? ` [PayPal-Request-Id ${call.requestId}]` : ""}${call.fault ? ` (${call.fault})` : ""}`);
    console.log(`  page said: "${v.told.slice(0, 600)}"`);
    if (forwardErrors.length) console.log(`  (DummyRun's page server couldn't reach the store: ${forwardErrors.splice(0).join("; ")})`);
    console.log("");
  }
} finally {
  await proxy.close();
}
