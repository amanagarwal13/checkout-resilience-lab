import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CheckoutPaymentIntent, Client, Environment, OrdersController } from "@paypal/paypal-server-sdk";
import { resilienceLab } from "../sdk/paypal.js";

// The one line a store adds: `...resilienceLab()` in its PayPal SDK client options.
test("resilienceLab() changes nothing unless Resilience Lab is stress-testing", () => {
  assert.deepEqual(resilienceLab(""), {});
  assert.deepEqual(resilienceLab(undefined), {});
});

test("resilienceLab(apiBase) sends the SDK's requests to Resilience Lab", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    res.writeHead(req.url?.includes("oauth2") ? 200 : 201, { "content-type": "application/json" });
    res.end(req.url?.includes("oauth2") ? JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 3600 }) : JSON.stringify({ id: "ORDER1", status: "CREATED" }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: "id", oAuthClientSecret: "secret" },
      environment: Environment.Sandbox,
      ...resilienceLab(`http://localhost:${(server.address() as AddressInfo).port}`),
    });
    const { result } = await new OrdersController(client).createOrder({
      body: { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ amount: { currencyCode: "USD", value: "1.00" } }] },
    });
    assert.equal(result.id, "ORDER1");
    assert.deepEqual(paths, ["POST /v1/oauth2/token", "POST /v2/checkout/orders"]);
  } finally {
    server.close();
  }
});
