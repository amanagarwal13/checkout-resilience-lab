import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { config } from "../config.js";

// Runs one store under test in its own process, so every stress test loads the
// store's code fresh from disk. A fix a developer (or their coding agent) just
// saved is exactly what the next test exercises.
// Usage: node --import tsx src/lab/storeHost.ts <storeDir> <paypalApiBase> <refundTimeoutMs>

const [storeDir, apiBase, refundTimeoutMs] = process.argv.slice(2);
const { createStoreApp } = await import(pathToFileURL(join(storeDir, "app.ts")).href);
const store = createStoreApp({
  refundTimeoutMs: Number(refundTimeoutMs),
  paypal: { clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, apiBase },
  openai: { apiKey: config.openaiApiKey, model: config.openaiModel },
});

serve({ fetch: store.app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
  process.stdout.write(`${JSON.stringify({ port: info.port })}\n`);
});
