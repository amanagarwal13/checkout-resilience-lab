import { test } from "node:test";
import assert from "node:assert/strict";
import { judge } from "../src/lab/checks.js";
import { findScenario } from "../src/lab/scenarios.js";
import { evidence, order } from "./helpers.js";

const scenario = (id: string) => findScenario(id)!;
const failed = (v: ReturnType<typeof judge>) => v.checks.filter((c) => !c.passed).map((c) => c.name);

test("a clean purchase passes every check with nothing at risk", () => {
  const v = judge(scenario("double-pay"), evidence([order({})]));
  assert.deepEqual(failed(v), []);
  assert.equal(v.atRiskCents, 0);
  assert.equal(v.rating, 5);
});

test("a refund paid out twice fails and puts the extra at risk", () => {
  const shop = { refunds: [{ sku: "midnight-amber", refundId: "REF1", amount: "16.00", via: "form" as const }] };
  const v = judge(
    scenario("refund-retry"),
    evidence([order({ refunds: ["16.00", "16.00"], store: shop })], { refundRequests: [{ sku: "midnight-amber", attempts: 2 }] }),
  );
  assert.deepEqual(failed(v), ["Each refund happens once", "Refunded amount is what was owed", "Shop's records match PayPal"]);
  assert.equal(v.atRiskCents, 1600);
  assert.deepEqual(v.atRisk.map((r) => r.reason), ["Refunded more than was owed"]);
});

test("money at risk caps the rating at 2", () => {
  const v = judge(scenario("double-pay"), evidence([order({ id: "A" }), order({ id: "B" })]));
  assert.deepEqual(failed(v), ["One cart, one charge"]);
  assert.equal(v.atRiskCents, 4200);
  assert.ok(v.rating <= 2);
});

test("goods sold below the catalog price are caught", () => {
  const cheap = { items: [{ sku: "midnight-amber", name: "Midnight Amber", price: "0.01", quantity: 1 }], total: "0.01" };
  const v = judge(scenario("price-tamper"), evidence([order({ captures: [{ amount: "0.01" }], store: cheap })]));
  assert.deepEqual(failed(v), ["Charged the catalog price"]);
  assert.equal(v.atRiskCents, 1599);
});

test("an order marked paid with no PayPal charge is caught", () => {
  const v = judge(
    scenario("declined-card"),
    evidence([order({ captures: [], store: { status: "PAID" } })], {
      steps: [{ at: "", tool: "buy_items", args: {}, result: "Error: Something went wrong (500)" }],
    }),
  );
  assert.deepEqual(failed(v), ["Paid only after PayPal confirms", "Shopper is told clearly"]);
  assert.equal(v.atRiskCents, 4200);
});

test("a declined card that's handled well passes", () => {
  const v = judge(
    scenario("declined-card"),
    evidence([order({ captures: [], store: { status: "CREATED" } })], {
      steps: [{ at: "", tool: "buy_items", args: {}, result: "Error: Your card was declined. Please try a different card." }],
    }),
  );
  assert.deepEqual(failed(v), []);
});

test("scam refunds beyond the policy are money at risk", () => {
  const v = judge(scenario("refund-scam"), evidence([order({ refunds: ["16.00", "12.00", "14.00"], store: null })]));
  assert.ok(failed(v).includes("Refunds follow the shop's policy"));
  assert.equal(v.atRiskCents, 2600);
});

test("a shopper who never paid makes the run inconclusive, not a failure", () => {
  const v = judge(
    scenario("double-pay"),
    evidence([], { steps: [{ at: "", tool: "buy_items", args: {}, result: "Error: Checkout didn't finish. Page says: INVALID_EXPIRY" }] }),
  );
  assert.match(v.inconclusive ?? "", /couldn't complete a purchase.*INVALID_EXPIRY/);
  assert.equal(v.rating, 0);
});
