import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chromium, type Page } from "playwright";
import { config } from "../config.js";
import { applyEdits, copyStore, describeEdits, syntaxCheck } from "../investigator/fixer.js";
import { investigateEvidence, readStoreSource } from "../investigator/investigator.js";
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
// Usage: npm run crash:paypal-example [-- baseline|double-pay|slow-capture|declined-card] [--fixed | --investigate | --store=<dir>]
// --investigate: for each failing scenario, the AI investigator reads the
// evidence and the example's source, its edits go into a copy under runs/,
// and the same scenario is re-run against the copy.
// --store=<dir>: crash-test another copy of the example, such as a patched one.

const FIXED = process.argv.includes("--fixed");
const INVESTIGATE = process.argv.includes("--investigate");
const OTHER_STORE = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
if ([FIXED, INVESTIGATE, OTHER_STORE].filter(Boolean).length > 1) {
  console.error("Pick one of --fixed, --investigate and --store=<dir>. --investigate works on the example as published.");
  process.exit(1);
}
const STORE_DIR = resolve(OTHER_STORE ?? (FIXED ? "stores/paypal-advanced-example-fixed" : "stores/paypal-advanced-example"));
// What the investigator reads and may edit. Never the hand-fixed copy.
const SOURCE_FILES = ["server.js", "client/app.js", "client/index.html"];
const STORE_NOTES = `This is PayPal's own advanced-integration example checkout, in plain JavaScript (no TypeScript, no build step).
server.js is the Express server; it talks to PayPal through the PayPal Server SDK (@paypal/paypal-server-sdk).
client/app.js runs in the shopper's browser: it renders PayPal's card fields and buttons (PayPal JS SDK) and calls the server's /api routes. client/index.html is the page.
The two lines marked "// DummyRun: added" in server.js connect the store to DummyRun's test harness; leave them as they are.`;
const SDK_IMPORT = "../../sdk/paypal.js";
const forwardErrors: string[] = [];

interface ExampleScenario {
  id: string;
  title: string;
  summary: string; // what the scripted shopper and DummyRun did, for the investigator
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
    summary: "The shopper filled in the card fields and billing address and clicked Pay once. No faults were injected.",
    faults: [],
    expectedCharges: 1,
    shopper: async (page) => {
      await page.click(payButton);
    },
  },
  {
    id: "double-pay",
    title: "Impatient shopper double-clicks Pay",
    summary: "The shopper filled in the card fields and billing address, then clicked the card form's Pay button twice, 150 ms apart, meaning to buy once. No faults were injected.",
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
    summary: "The shopper filled in the card fields and billing address and clicked Pay. DummyRun let PayPal process the first capture but held its answer back for 8 seconds. After 4 seconds with nothing on the page, the shopper clicked Pay again, meaning to buy once.",
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
    summary: "The shopper filled in the card fields and billing address and clicked Pay once. DummyRun asked PayPal's sandbox to decline the card at capture (PayPal-Mock-Response INSTRUMENT_DECLINED), so no money should move and the shopper should be told the card was declined.",
    faults: [{ name: "card declined", method: "POST", path: /\/v2\/checkout\/orders\/[^/]+\/capture$/, action: "mock-response", mockCode: "INSTRUMENT_DECLINED", times: 1 }],
    expectedCharges: 0,
    shopper: async (page) => {
      await page.click(payButton);
    },
    extraCheck: (told) => ({ name: "Shopper is told the card was declined", passed: /declined/i.test(told), detail: `page said: "${told.slice(0, 160)}"` }),
  },
];

// One request on its own connection (no keep-alive, no retry). Cookies pass
// both ways, as they do through Vite's proxy.
function forward(port: number, method: string, path: string, cookie: string | undefined, body?: string): Promise<{ status: number; type: string; setCookie: string[]; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "localhost", port, method, path, agent: false, headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) } }, (res) => {
      let data = "";
      res.setEncoding("utf8").on("data", (d) => (data += d)).on("end", () => ok({ status: res.statusCode ?? 502, type: res.headers["content-type"] ?? "application/json", setCookie: res.headers["set-cookie"] ?? [], body: data }));
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
async function startExample(storeDir: string, apiBase: string, logFile: string) {
  const apiPort = await freePort();
  const log = createWriteStream(logFile);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: storeDir,
    env: { ...process.env, PORT: String(apiPort), PAYPAL_CLIENT_ID: config.paypalClientId, PAYPAL_CLIENT_SECRET: config.paypalClientSecret, DUMMYRUN_PAYPAL_API: apiBase },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  await new Promise<void>((ok, fail) => {
    server.stdout.on("data", (d: Buffer) => d.toString().includes("listening") && ok());
    server.once("exit", (code) => fail(new Error(`PayPal's example server exited (code ${code}); see ${logFile}`)));
  });

  const page = readFileSync(join(storeDir, "client/index.html"), "utf8").replaceAll("%PAYPAL_CLIENT_ID%", config.paypalClientId);
  const app = new Hono();
  app.get("/", (c) => c.html(page));
  app.get("/app.js", (c) => c.body(readFileSync(join(storeDir, "client/app.js"), "utf8"), 200, { "Content-Type": "text/javascript" }));
  // Forwards like Vite's dev proxy, one connection per request and never retried,
  // so every payment request the page makes reaches PayPal's server exactly once.
  app.all("/api/*", async (c) => {
    const path = new URL(c.req.url).pathname;
    try {
      const { status, type, setCookie, body } = await forward(apiPort, c.req.method, path, c.req.header("Cookie"), c.req.method === "GET" ? undefined : await c.req.text());
      for (const cookie of setCookie) c.header("Set-Cookie", cookie, { append: true });
      return c.body(body, status as 200, { "Content-Type": type });
    } catch (error) {
      forwardErrors.push(`${c.req.method} ${path}: ${(error as Error).cause ?? error}`);
      return c.json({ error: "DummyRun couldn't reach the store" }, 502);
    }
  });
  const front = await new Promise<ReturnType<typeof serve>>((ok) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => ok(s));
  });
  const url = `http://localhost:${(front.address() as AddressInfo).port}`;
  return { url, stop: () => { front.close(); server.kill(); log.end(); } };
}

async function run(scenario: ExampleScenario, proxy: PayPalProxy, dir: string, storeDir = STORE_DIR) {
  mkdirSync(dir, { recursive: true });
  proxy.reset();
  proxy.setRules(scenario.faults);
  const store = await startExample(storeDir, proxy.url, join(dir, "store.log"));
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
  return { ...verdict, proxyLog: [...proxy.log] };
}

type ExampleResult = Awaited<ReturnType<typeof run>>;

function show(v: ExampleResult) {
  if (v.inconclusive) console.log(`  inconclusive: ${v.inconclusive}`);
  else console.log(`  ${v.rating}/5, $${fromCents(v.atRiskCents)} at risk`);
  for (const c of v.checks) console.log(`  ${c.passed ? "pass" : "FAIL"} ${c.name}: ${c.detail}`);
  for (const call of v.paypalCalls) console.log(`    ${call.call} -> ${call.status}${call.requestId ? ` [PayPal-Request-Id ${call.requestId}]` : ""}${call.fault ? ` (${call.fault})` : ""}`);
  console.log(`  page said: "${v.told.slice(0, 600)}"`);
  if (forwardErrors.length) console.log(`  (DummyRun's page server couldn't reach the store: ${forwardErrors.splice(0).join("; ")})`);
}

// What the store printed besides the SDK's request log: its own console.error
// output, with paths made relative to the store so they match the source.
function storeErrors(logFile: string, storeDir: string) {
  const prefix = `${pathToFileURL(storeDir).href}/`;
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("info:") && !l.includes("listening at"))
    .map((l) => l.replaceAll(prefix, "").slice(0, 300))
    .slice(0, 40);
}

// The same shape of evidence the investigator gets for the demo store.
function evidenceFor(scenario: ExampleScenario, v: ExampleResult, logFile: string) {
  return JSON.stringify(
    {
      scenario: { id: scenario.id, title: scenario.title, whatDummyRunDid: scenario.summary },
      failedChecks: v.checks.filter((c) => !c.passed),
      moneyAtRisk: `$${fromCents(v.atRiskCents)}`,
      paypalCalls: v.proxyLog.filter((e) => !e.path.includes("oauth2")).map((e) => ({
        call: `${e.method} ${e.path}`,
        status: e.status,
        paypalRequestId: e.requestId ?? null,
        injectedFault: e.fault ?? null,
        result: e.summary ?? null,
      })),
      pageSaid: v.told,
      storeConsoleErrors: storeErrors(logFile, STORE_DIR),
    },
    null,
    2,
  );
}

// Investigate one failed scenario, patch a copy, check it parses, re-run.
async function investigateAndRerun(scenario: ExampleScenario, before: ExampleResult, dir: string) {
  console.log("  [Investigator] reading the evidence and the example's code…");
  const evidence = evidenceFor(scenario, before, join(dir, "store.log"));
  const diagnosis = await investigateEvidence({ evidence, source: readStoreSource(STORE_DIR, SOURCE_FILES), storeNotes: STORE_NOTES });
  console.log(`  Why it broke: ${diagnosis.explanation}`);
  console.log(`  Where: ${diagnosis.rootCause.file}:${diagnosis.rootCause.line}`);
  console.log(`  Fix: ${diagnosis.fix.summary}`);
  console.log(`  PayPal guidance: ${diagnosis.paypalGuidance}`);
  console.log(`\n${describeEdits(diagnosis.fix.edits).replace(/^/gm, "    ")}\n`);

  const patchedDir = resolve(dir, "patched-store");
  copyStore(STORE_DIR, patchedDir, SOURCE_FILES);
  applyEdits(patchedDir, diagnosis.fix.edits);
  // The copy lives deeper in the repo, so point DummyRun's SDK import at the same file.
  const serverPath = join(patchedDir, "server.js");
  const sdkPath = relative(patchedDir, resolve("sdk/paypal.js")).replaceAll("\\", "/");
  writeFileSync(serverPath, readFileSync(serverPath, "utf8").replace(`"${SDK_IMPORT}"`, () => `"${sdkPath}"`));
  const checked = await syntaxCheck(patchedDir, SOURCE_FILES);
  const record: Record<string, unknown> = { scenario: scenario.id, evidence: JSON.parse(evidence), diagnosis, syntaxCheck: checked };
  if (!checked.ok) {
    console.log(`  The patch doesn't parse, so DummyRun won't run it:\n${checked.output}`);
  } else {
    console.log("  Patch parses (node --check). Re-running the same scenario against the patched copy…");
    const after = await run(scenario, proxy, join(dir, "patched"), patchedDir);
    console.log("  [After: patched copy]");
    show(after);
    const fixed = !after.inconclusive && after.checks.every((c) => c.passed) && after.atRiskCents === 0;
    console.log(`\n  ${before.rating}/5 → ${after.rating}/5 · $${fromCents(before.atRiskCents)} → $${fromCents(after.atRiskCents)} at risk · ${fixed ? "FIXED" : "NOT FIXED"}`);
    record.after = { inconclusive: after.inconclusive, told: after.told, checks: after.checks, atRiskCents: after.atRiskCents, rating: after.rating, paypalCalls: after.paypalCalls, fixed };
  }
  writeFileSync(join(dir, "investigation.json"), JSON.stringify(record, null, 2));
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const picked = wanted.length ? scenarios.filter((s) => wanted.includes(s.id)) : scenarios;
const runDir = join("runs", FIXED ? "paypal-example-fixed" : INVESTIGATE ? "paypal-example-investigate" : OTHER_STORE ? "paypal-example-other" : "paypal-example", new Date().toISOString().replace(/[:.]/g, "-"));
const proxy = createPayPalProxy({ port: 0 });
await proxy.listen();
console.log(`Crash-testing PayPal's advanced-integration example${FIXED ? " with the DummyRun fixes" : OTHER_STORE ? ` from ${STORE_DIR}` : " as published"}${INVESTIGATE ? ", investigating failures" : ""}. Recordings in ${runDir}\n`);
try {
  for (const scenario of picked) {
    const dir = join(runDir, scenario.id);
    const v = await run(scenario, proxy, dir);
    console.log(`${scenario.title}`);
    if (INVESTIGATE) console.log("  [Before: the example as published]");
    show(v);
    if (INVESTIGATE) {
      if (v.inconclusive) console.log("  The test didn't get far enough to judge the store, so there's nothing to investigate. Try again.");
      else if (v.checks.every((c) => c.passed)) console.log("  Nothing to fix: every check passed.");
      else await investigateAndRerun(scenario, v, dir).catch((error) => {
        console.log(`  The investigator didn't produce a usable patch: ${(error as Error).message}`);
        writeFileSync(join(dir, "investigation.json"), JSON.stringify({ scenario: scenario.id, error: (error as Error).message }, null, 2));
      });
    }
    console.log("");
  }
} finally {
  await proxy.close();
}
