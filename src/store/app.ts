import { Hono } from "hono";
import { ApiError, CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { catalog, findProduct, fromCents, toCents } from "./catalog.js";
import { orderPage, shopPage } from "./pages.js";
import { createPayPal, isTimeout, type PayPalClientOptions } from "../paypal/client.js";

// "original" ships the bug DummyRun should catch; "fixed" is the same store after the fix.
export type StoreMode = "original" | "fixed";

export interface StoreOrder {
  id: string; // PayPal order ID
  items: { sku: string; name: string; price: string; quantity: number }[];
  total: string;
  status: "CREATED" | "PAID";
  captureId?: string;
  refunds: { sku: string; refundId: string; amount: string }[];
}

export interface StoreOptions {
  mode: StoreMode;
  paypal: PayPalClientOptions;
  refundTimeoutMs?: number;
}

export function createStoreApp({ mode, paypal: paypalOptions, refundTimeoutMs = 4_000 }: StoreOptions) {
  const paypal = createPayPal(paypalOptions);
  const orders = new Map<string, StoreOrder>();
  const app = new Hono();

  app.get("/", (c) => c.html(shopPage({ clientId: paypalOptions.clientId, mode })));

  app.post("/api/orders", async (c) => {
    const { items } = await c.req.json<{ items: { sku: string; quantity: number }[] }>();
    // Prices always come from the server-side catalog, never from the browser.
    const lines = items
      .filter((i) => i.quantity > 0)
      .map((i) => {
        const product = findProduct(i.sku);
        if (!product) throw new Error(`Unknown product ${i.sku}`);
        return { sku: product.sku, name: product.name, price: product.price, quantity: Math.min(Math.floor(i.quantity), 10) };
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
    const { result } = await paypal.orders.captureOrder({ id: order.id });
    const capture = result.purchaseUnits?.[0]?.payments?.captures?.[0];
    if (result.status !== "COMPLETED" || !capture?.id) {
      return c.json({ error: `Payment not completed (${result.status})` }, 402);
    }
    order.status = "PAID";
    order.captureId = capture.id;
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

  // Refund one damaged item. This is where the two modes differ.
  app.post("/api/orders/:id/refunds", async (c) => {
    const order = orders.get(c.req.param("id"));
    if (!order?.captureId) return c.json({ error: "Order not found or not paid" }, 404);
    const { sku } = await c.req.json<{ sku: string; reason?: string }>();
    const line = order.items.find((i) => i.sku === sku);
    if (!line) return c.json({ error: "That item isn't in this order" }, 400);

    try {
      const { result } = await paypal.payments.refundCapturedPayment(
        {
          captureId: order.captureId,
          body: { amount: { currencyCode: "USD", value: line.price } },
          // The fix: one stable request ID per refunded item, so a retry
          // returns the refund PayPal already made instead of making another.
          ...(mode === "fixed" ? { paypalRequestId: `refund-${order.id}-${sku}` } : {}),
        },
        { abortSignal: AbortSignal.timeout(refundTimeoutMs) },
      );
      if (!order.refunds.some((r) => r.refundId === result.id)) {
        order.refunds.push({ sku, refundId: result.id!, amount: line.price });
      }
      return c.json({ ok: true, refundId: result.id, amount: line.price });
    } catch (error) {
      if (isTimeout(error)) {
        return c.json({ error: "The refund request timed out. Please try again." }, 504);
      }
      if (error instanceof ApiError) {
        return c.json({ error: `PayPal refused the refund (${error.statusCode})` }, 502);
      }
      throw error;
    }
  });

  return { app, orders, mode, catalog };
}
