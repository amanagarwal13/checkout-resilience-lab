import type { Evidence, OrderEvidence } from "../src/lab/checks.js";
import type { StoreOrder } from "../src/lab/storeProfile.js";

// Builders for synthetic evidence, so the money checks can be tested without PayPal.

export function storeOrder(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    id: "ORDER1",
    items: [
      { sku: "cedar-ember", name: "Cedar Ember", price: "12.00", quantity: 1 },
      { sku: "sea-salt-fig", name: "Sea Salt Fig", price: "14.00", quantity: 1 },
      { sku: "midnight-amber", name: "Midnight Amber", price: "16.00", quantity: 1 },
    ],
    total: "42.00",
    status: "PAID",
    captureId: "CAP1",
    refunds: [],
    ...overrides,
  };
}

export function order(o: {
  id?: string;
  captures?: { amount: string; status?: string }[];
  refunds?: string[];
  store?: Partial<StoreOrder> | null;
}): OrderEvidence {
  const id = o.id ?? "ORDER1";
  return {
    orderId: id,
    money: {
      orderStatus: "COMPLETED",
      captures: (o.captures ?? [{ amount: "42.00" }]).map((c, i) => ({ id: `CAP${i + 1}`, amount: c.amount, status: c.status ?? "COMPLETED" })),
      refunds: (o.refunds ?? []).map((amount, i) => ({ id: `REF${i + 1}`, amount, status: "COMPLETED", createdAt: "2026-10-20T00:00:00Z" })),
    },
    storeOrder: o.store === null ? undefined : storeOrder({ id, ...o.store }),
  };
}

export function evidence(orders: OrderEvidence[], shopper: Partial<Evidence["shopper"]> = {}): Evidence {
  return { shopper: { persona: "test", steps: [], refundRequests: [], ...shopper }, orders };
}
