import { Hono } from "hono";
import { ApiError, CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { findProduct, fromCents, toCents } from "./catalog.js";
import { orderPage, shopPage } from "./pages.js";
import { createPayPal, isTimeout, type PayPalOptions } from "./paypal.js";
import { createSupportBot } from "./supportBot.js";

export interface StoreOrder {
  id: string; // PayPal order ID
  items: { sku: string; name: string; price: string; quantity: number }[];
  total: string;
  status: "CREATED" | "PAID";
  captureId?: string;
  refunds: { sku: string; refundId: string; amount: string; via: RefundChannel }[];
}

export type RefundChannel = "form" | "support-bot";
export type RefundOutcome =
  | { ok: true; refundId: string; amount: string }
  | { ok: false; status: 400 | 402 | 404 | 409 | 502 | 504; error: string };

export interface StoreOptions {
  paypal: PayPalOptions;
  openai: { apiKey: string; model: string };
  refundTimeoutMs?: number;
}

export function createStoreApp({ paypal: paypalOptions, openai, refundTimeoutMs = 4_000 }: StoreOptions) {
  const paypal = createPayPal(paypalOptions);
  const orders = new Map<string, StoreOrder>();
  const app = new Hono();

  // Log one line, never the full SDK error: it carries the request headers,
  // including the PayPal access token.
  app.onError((error, c) => {
    const status = error instanceof ApiError ? ` (PayPal ${error.statusCode})` : "";
    console.error(`[store] ${c.req.method} ${c.req.path} failed: ${error.name}${status}`);
    return c.json({ error: "Something went wrong" }, 500);
  });

  app.get("/", (c) => c.html(shopPage({ clientId: paypalOptions.clientId })));

  app.post("/api/orders", async (c) => {
    const { items } = await c.req.json<{ items: { sku: string; quantity: number; price?: string }[] }>();
    const lines = items
      .filter((i) => i.quantity > 0)
      .map((i) => {
        const product = findProduct(i.sku);
        if (!product) throw new Error(`Unknown product ${i.sku}`);
        const price = i.price ?? product.price;
        return { sku: product.sku, name: product.name, price, quantity: Math.min(Math.floor(i.quantity), 10) };
      });
    if (lines.length === 0) return c.json({ error: "Your cart is empty" }, 400);
    const total = fromCents(lines.reduce((sum, l) => sum + toCents(l.price) * l.quantity, 0));

    const { result } = await paypal.orders.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: { currencyCode: "USD", value: total, breakdown: { itemTotal: { currencyCode: "USD", value: total } } },
            items: lines.map((l) => ({
              name: l.name,
              sku: l.sku,
              quantity: String(l.quantity),
              unitAmount: { currencyCode: "USD", value: l.price },
            })),
          },
        ],
      },
    });
    orders.set(result.id!, { id: result.id!, items: lines, total, status: "CREATED", refunds: [] });
    return c.json({ id: result.id });
  });

  app.post("/api/orders/:id/capture", async (c) => {
    const order = orders.get(c.req.param("id"));
    if (!order) return c.json({ error: "Order not found" }, 404);
    order.status = "PAID";
    const { result } = await paypal.orders.captureOrder({ id: order.id });
    order.captureId = result.purchaseUnits?.[0]?.payments?.captures?.[0]?.id;
    return c.json({ id: order.id, status: order.status });
  });

  app.get("/api/orders/:id", (c) => {
    const order = orders.get(c.req.param("id"));
    return order ? c.json(order) : c.json({ error: "Order not found" }, 404);
  });

  app.get("/orders/:id", (c) => {
    const order = orders.get(c.req.param("id"));
    return order ? c.html(orderPage(order)) : c.text("Order not found", 404);
  });

  // Refund one item. Shared by the refund form and the support bot.
  async function refundItem(order: StoreOrder, sku: string, via: RefundChannel): Promise<RefundOutcome> {
    if (!order.captureId) return { ok: false, status: 404, error: "Order not found or not paid" };
    const line = order.items.find((i) => i.sku === sku);
    if (!line) return { ok: false, status: 400, error: "That item isn't in this order" };

    try {
      const { result } = await paypal.payments.refundCapturedPayment(
        { captureId: order.captureId, body: { amount: { currencyCode: "USD", value: line.price } } },
        { abortSignal: AbortSignal.timeout(refundTimeoutMs) },
      );
      order.refunds.push({ sku, refundId: result.id!, amount: line.price, via });
      return { ok: true, refundId: result.id!, amount: line.price };
    } catch (error) {
      if (isTimeout(error)) return { ok: false, status: 504, error: "The refund request timed out. Please try again." };
      if (error instanceof ApiError) return { ok: false, status: 502, error: `PayPal refused the refund (${error.statusCode})` };
      throw error;
    }
  }

  app.post("/api/orders/:id/refunds", async (c) => {
    const order = orders.get(c.req.param("id"));
    if (!order) return c.json({ error: "Order not found or not paid" }, 404);
    const { sku } = await c.req.json<{ sku: string; reason?: string }>();
    const outcome = await refundItem(order, sku, "form");
    return outcome.ok ? c.json(outcome) : c.json({ error: outcome.error }, outcome.status);
  });

  const supportBot = createSupportBot({ openai, refundItem });
  app.post("/api/orders/:id/support", async (c) => {
    const order = orders.get(c.req.param("id"));
    if (!order) return c.json({ error: "Order not found" }, 404);
    const { message } = await c.req.json<{ message: string }>();
    return c.json({ reply: await supportBot.chat(order, String(message ?? "").slice(0, 2_000)) });
  });

  return { app, orders };
}
