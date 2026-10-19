import { Hono } from "hono";
import { limit } from "../src/server/limits.js";

// Quick check of the demo's spending guards on a throwaway app.
const app = new Hono();
app.post("/x", limit("test runs", 2, 3), (c) => c.json({ ok: true }));
const call = (ip: string) => app.request("/x", { method: "POST", headers: { "x-forwarded-for": ip } }).then((r) => r.status);

const results = [await call("1.1.1.1"), await call("1.1.1.1"), await call("1.1.1.1"), await call("2.2.2.2"), await call("3.3.3.3")];
console.log(results.join(" "));
console.log(results.join(" ") === "200 200 429 200 429" ? "limits behave as expected" : "UNEXPECTED");
