import { findProduct, fromCents, toCents, type StoreOrder } from "./storeProfile.js";
import type { ShopperRun } from "../shopper/shopper.js";
import type { PayPalMoney } from "./paypalDirect.js";
import type { Scenario } from "./scenarios.js";

export interface Check { name: string; passed: boolean; detail: string }

export interface OrderEvidence {
  orderId: string;
  money?: PayPalMoney; // straight from PayPal
  storeOrder?: StoreOrder; // what the shop believes
}

export interface Evidence {
  shopper: ShopperRun;
  orders: OrderEvidence[];
}

export interface Verdict {
  // Set when the test itself didn't get far enough to judge the store, for
  // example the shopper never managed to pay. Not counted against the store.
  inconclusive?: string;
  checks: Check[];
  atRiskCents: number;
  atRisk: { reason: string; cents: number }[];
  rating: number; // 1 to 5
}

// What the order should have cost, from the server-side catalog.
function catalogCents(order?: StoreOrder) {
  return (order?.items ?? []).reduce((sum, i) => sum + toCents(findProduct(i.sku)?.price ?? "0") * i.quantity, 0);
}

const usd = (cents: number) => `$${fromCents(cents)}`;

export function judge(scenario: Scenario, evidence: Evidence): Verdict {
  const { orders } = evidence;
  const charges = orders.flatMap((o) => (o.money?.captures ?? []).filter((c) => c.status === "COMPLETED" || c.status === "PARTIALLY_REFUNDED" || c.status === "REFUNDED").map((c) => ({ order: o, cents: toCents(c.amount) })));
  const refunds = orders.flatMap((o) => o.money?.refunds ?? []);
  const refundedCents = refunds.reduce((sum, r) => sum + toCents(r.amount), 0);
  const owedCents = scenario.owedCents(evidence);
  const storeRefundCount = orders.reduce((n, o) => n + (o.storeOrder?.refunds.length ?? 0), 0);

  const underpaid = charges
    .map((c) => ({ c, short: catalogCents(c.order.storeOrder) - c.cents }))
    .filter((x) => x.short > 0);
  const paidWithoutCharge = orders.filter((o) => o.storeOrder?.status === "PAID" && !charges.some((c) => c.order === o));

  const checks: Check[] = [
    {
      name: "One cart, one charge",
      passed: charges.length === scenario.expectedCharges,
      detail: `expected ${scenario.expectedCharges} charge(s), PayPal shows ${charges.length}${charges.length ? `: ${charges.map((c) => usd(c.cents)).join(", ")}` : ""}`,
    },
    {
      name: "Charged the catalog price",
      passed: underpaid.length === 0,
      detail: charges.length
        ? charges.map((c) => `charged ${usd(c.cents)} for goods worth ${usd(catalogCents(c.order.storeOrder))}`).join("; ")
        : "no charges",
    },
    {
      name: "Paid only after PayPal confirms",
      passed: paidWithoutCharge.length === 0,
      detail: paidWithoutCharge.length
        ? `shop marked ${paidWithoutCharge.length} order(s) paid with no completed PayPal charge`
        : "every order the shop marked paid has a completed PayPal charge",
    },
    ...(scenario.extraChecks?.(evidence, owedCents, refundedCents) ?? []),
    {
      name: "Refunded amount is what was owed",
      passed: refundedCents === owedCents,
      detail: `owed ${usd(owedCents)}, PayPal refunded ${usd(refundedCents)}${refunds.length ? `: ${refunds.map((r) => `${r.id} $${r.amount}`).join(", ")}` : ""}`,
    },
    {
      name: "Shop's records match PayPal",
      passed: storeRefundCount === refunds.length,
      detail: `shop recorded ${storeRefundCount} refund(s), PayPal has ${refunds.length}`,
    },
  ];

  const atRisk = [
    { reason: "Customer charged more than once", cents: charges.slice(scenario.expectedCharges).reduce((s, c) => s + c.cents, 0) },
    { reason: "Goods sold below the catalog price", cents: underpaid.reduce((s, x) => s + x.short, 0) },
    { reason: "Orders marked paid that were never charged", cents: paidWithoutCharge.reduce((s, o) => s + catalogCents(o.storeOrder), 0) },
    { reason: "Refunded more than was owed", cents: Math.max(0, refundedCents - owedCents) },
  ].filter((r) => r.cents > 0);

  const passed = checks.filter((c) => c.passed).length;
  const atRiskCents = atRisk.reduce((s, r) => s + r.cents, 0);
  if (scenario.expectedCharges > 0 && orders.length === 0) {
    const said = evidence.shopper.steps.find((s) => s.tool === "buy_items")?.result ?? "the shopper never tried to pay";
    return { inconclusive: `The test shopper couldn't complete a purchase (${said.replace(/^Error: /, "")}).`, checks, atRisk, atRiskCents, rating: 0 };
  }
  // Losing money caps the rating at 2, however many other checks pass.
  const base = Math.max(1, Math.round((5 * passed) / checks.length));
  return { checks, atRisk, atRiskCents, rating: atRiskCents > 0 ? Math.min(base, 2) : base };
}
