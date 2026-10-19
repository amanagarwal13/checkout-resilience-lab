import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { config } from "../config.js";
import { findProduct, fromCents, toCents } from "../store/catalog.js";
import { createStoreApp, type StoreMode } from "../store/app.js";
import { runShopper, type Persona } from "../shopper/shopper.js";
import { moneyForOrder } from "./paypalDirect.js";
import { createPayPalProxy } from "./proxy.js";

// Scenario: an AI shopping agent buys a gift set, one candle arrives cracked,
// and it asks for a refund for that candle. DummyRun lets PayPal process the
// refund but holds PayPal's answer, so the store sees a timeout. The agent,
// like real agents do, tries again.
const persona: Persona = {
  name: "AI shopping agent",
  instructions: `You are an AI shopping agent acting for your user, Priya.
1. Look at the shop and buy one of each candle as a gift set.
2. Priya then tells you the Midnight Amber candle arrived cracked. Request a refund for that one candle only, using the order ID from the purchase and "Arrived cracked" as the reason.
3. You are persistent: if a request fails or times out, try it again, up to 3 attempts in total.
4. When the refund is confirmed, or you have given up, call finish.
Use the tools; don't ask questions.`,
};

interface Check { name: string; passed: boolean; detail: string }

const STORE_TIMEOUT_MS = 4_000;
const HELD_FOR_MS = 8_000;
const ports: Record<StoreMode, number> = { original: 4200, fixed: 4201 };

const runDir = join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
const proxy = createPayPalProxy({ port: 4020 });
await proxy.listen();

const modes = (process.argv[2] ? [process.argv[2]] : ["original", "fixed"]) as StoreMode[];
const summaries: { mode: StoreMode; checks: Check[]; atRisk: string }[] = [];

for (const mode of modes) {
  console.log(`\n=== Crash test: refund retry under a PayPal timeout · store build "${mode}" ===`);
  proxy.reset();
  proxy.setRules([
    { name: "slow refund", method: "POST", path: /\/v2\/payments\/captures\/[^/]+\/refund$/, action: "delay-response", delayMs: HELD_FOR_MS, times: 1 },
  ]);

  const store = createStoreApp({
    mode,
    refundTimeoutMs: STORE_TIMEOUT_MS,
    paypal: { clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, apiBase: proxy.url },
  });
  const server = serve({ fetch: store.app.fetch, port: ports[mode] });
  const dir = join(runDir, mode);
  mkdirSync(dir, { recursive: true });

  const shopper = await runShopper({ storeUrl: `http://localhost:${ports[mode]}`, persona, videoDir: dir });
  // Let the held PayPal answer finish before reading the books.
  await new Promise((r) => setTimeout(r, HELD_FOR_MS));

  const checks: Check[] = [];
  let atRiskCents = 0;
  if (!shopper.orderId) {
    checks.push({ name: "Shopper completed a purchase", passed: false, detail: "No order was placed" });
  } else {
    const money = await moneyForOrder(shopper.orderId);
    const storeOrder = store.orders.get(shopper.orderId);

    checks.push({
      name: "One cart, one charge",
      passed: money.captures.length === 1,
      detail: `${money.captures.length} charge(s): ${money.captures.map((c) => `$${c.amount}`).join(", ")}`,
    });

    const intendedCents = shopper.refundRequests.reduce((sum, r) => sum + toCents(findProduct(r.sku)?.price ?? "0"), 0);
    const refundedCents = money.refunds.reduce((sum, r) => sum + toCents(r.amount), 0);
    atRiskCents = Math.max(0, refundedCents - intendedCents);
    checks.push({
      name: "Each refund happens once",
      passed: money.refunds.length === shopper.refundRequests.length,
      detail: `${shopper.refundRequests.length} item(s) to refund, PayPal made ${money.refunds.length} refund(s): ${money.refunds.map((r) => `${r.id} $${r.amount}`).join(", ") || "none"}`,
    });
    checks.push({
      name: "Refunded amount matches the request",
      passed: refundedCents === intendedCents,
      detail: `asked for $${fromCents(intendedCents)}, PayPal refunded $${fromCents(refundedCents)}`,
    });
    checks.push({
      name: "Shop's records match PayPal",
      passed: storeOrder?.refunds.length === money.refunds.length,
      detail: `shop recorded ${storeOrder?.refunds.length ?? 0} refund(s), PayPal has ${money.refunds.length}`,
    });

    writeFileSync(join(dir, "report.json"), JSON.stringify({ mode, persona: persona.name, shopper, paypal: money, storeOrder, proxyLog: proxy.log, checks }, null, 2));
  }

  for (const c of checks) console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
  console.log(`  Money at risk this run: $${fromCents(atRiskCents)}`);
  summaries.push({ mode, checks, atRisk: fromCents(atRiskCents) });
  server.close();
}

console.log("\n=== Summary ===");
for (const s of summaries) {
  const passed = s.checks.filter((c) => c.passed).length;
  console.log(`  ${s.mode.padEnd(8)} ${passed}/${s.checks.length} checks passed · money at risk $${s.atRisk}`);
}
console.log(`  Reports and video: ${runDir}`);
await proxy.close();
process.exit(0);
