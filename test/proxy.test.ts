import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createPayPalProxy } from "../src/lab/proxy.js";

// A stand-in for PayPal that records what reached it.
async function fakePayPal() {
  const received: { method: string; url: string; headers: IncomingMessage["headers"]; at: number }[] = [];
  const server = createServer((req, res) => {
    received.push({ method: req.method!, url: req.url!, headers: req.headers, at: Date.now() });
    const mock = req.headers["paypal-mock-response"];
    res.setHeader("paypal-debug-id", "debug123");
    if (mock) {
      res.writeHead(422, { "content-type": "application/json" });
      return res.end(JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: JSON.parse(String(mock)).mock_application_codes }] }));
    }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url?.endsWith("/refund") ? { id: "REF1", status: "COMPLETED", amount: { value: "16.00" } } : { id: "ORDER1", status: "CREATED" }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  return { url: `http://localhost:${(server.address() as AddressInfo).port}`, received, close: () => server.close() };
}

test("forwards calls to PayPal and logs the IDs that matter", async () => {
  const paypal = await fakePayPal();
  const proxy = createPayPalProxy({ port: 0, upstream: paypal.url });
  await proxy.listen();
  try {
    const res = await fetch(`${proxy.url}/v2/checkout/orders`, { method: "POST", headers: { "PayPal-Request-Id": "abc" }, body: "{}" });
    assert.equal(res.status, 201);
    assert.equal(paypal.received.length, 1);
    assert.equal(proxy.log[0].summary?.orderId, "ORDER1");
    assert.equal(proxy.log[0].requestId, "abc");
    assert.equal(proxy.log[0].debugId, "debug123");
  } finally {
    await proxy.close();
    paypal.close();
  }
});

test("delay-response lets PayPal process the call, then holds the answer", async () => {
  const paypal = await fakePayPal();
  const proxy = createPayPalProxy({ port: 0, upstream: paypal.url });
  await proxy.listen();
  proxy.setRules([{ name: "slow refund", method: "POST", path: /\/refund$/, action: "delay-response", delayMs: 1_500, times: 1 }]);
  try {
    const start = Date.now();
    const timedOut = await fetch(`${proxy.url}/v2/payments/captures/CAP1/refund`, { method: "POST", body: "{}", signal: AbortSignal.timeout(500) })
      .then(() => false)
      .catch(() => true);
    assert.ok(timedOut, "the store should see a timeout");
    assert.equal(paypal.received.length, 1, "but PayPal already processed the refund");
    assert.ok(paypal.received[0].at - start < 400);
    assert.match(proxy.log[0].fault ?? "", /answer held/);

    // The rule ran once; the retry goes straight through.
    const retry = await fetch(`${proxy.url}/v2/payments/captures/CAP1/refund`, { method: "POST", body: "{}" });
    assert.equal(retry.status, 201);
    assert.equal(paypal.received.length, 2);
  } finally {
    await proxy.close();
    paypal.close();
  }
});

test("mock-response adds PayPal's negative-testing header", async () => {
  const paypal = await fakePayPal();
  const proxy = createPayPalProxy({ port: 0, upstream: paypal.url });
  await proxy.listen();
  proxy.setRules([{ name: "card declined", method: "POST", path: /\/capture$/, action: "mock-response", mockCode: "INSTRUMENT_DECLINED", times: 1 }]);
  try {
    const res = await fetch(`${proxy.url}/v2/checkout/orders/ORDER1/capture`, { method: "POST", body: "{}" });
    assert.equal(res.status, 422);
    assert.equal(JSON.parse(String(paypal.received[0].headers["paypal-mock-response"])).mock_application_codes, "INSTRUMENT_DECLINED");
    assert.equal(proxy.log[0].summary?.issue, "INSTRUMENT_DECLINED");
  } finally {
    await proxy.close();
    paypal.close();
  }
});
