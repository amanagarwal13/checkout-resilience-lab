import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { limit } from "../src/server/limits.js";

test("limits apply per visitor per hour and to the whole service per day", async () => {
  const app = new Hono();
  app.post("/x", limit("test runs", 2, 3), (c) => c.json({ ok: true }));
  const call = async (ip: string) => (await app.request("/x", { method: "POST", headers: { "x-forwarded-for": ip } })).status;

  assert.equal(await call("1.1.1.1"), 200);
  assert.equal(await call("1.1.1.1"), 200);
  assert.equal(await call("1.1.1.1"), 429, "third call from one visitor in an hour");
  assert.equal(await call("2.2.2.2"), 200, "another visitor still gets in");
  assert.equal(await call("3.3.3.3"), 429, "the daily limit for the whole demo is reached");
});
