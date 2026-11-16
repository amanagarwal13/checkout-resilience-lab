import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { createPayPal } from "../stores/ember-and-wick/original/paypal.js";

// The one setting a store needs: with apiBase set, the official PayPal Server SDK
// sends every request (token and API calls) to Resilience Lab instead of PayPal.
test("apiBase sends the official SDK's requests to Resilience Lab", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    res.writeHead(req.url?.includes("oauth2") ? 200 : 201, { "content-type": "application/json" });
    res.end(
      req.url?.includes("oauth2")
        ? JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 })
        : JSON.stringify({ id: "ORDER1", status: "CREATED" }),
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    const paypal = createPayPal({ clientId: "id", clientSecret: "secret", apiBase: `http://localhost:${(server.address() as AddressInfo).port}` });
    const { result } = await paypal.orders.createOrder({
      body: { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ amount: { currencyCode: "USD", value: "1.00" } }] },
    });
    assert.equal(result.id, "ORDER1");
    assert.deepEqual(paths, ["POST /v1/oauth2/token", "POST /v2/checkout/orders"]);
  } finally {
    server.close();
  }
});
