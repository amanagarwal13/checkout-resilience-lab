import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createPayPalProxy } from "./lab/proxy.js";
import { storeBuilds } from "./lab/storeProfile.js";

// Runs the PayPal proxy and both builds of the demo store for manual browsing.
const proxy = createPayPalProxy({ port: 4010 });
await proxy.listen();
console.log(`PayPal proxy       ${proxy.url}`);

const ports = { original: 4100, fixed: 4101 };
for (const label of ["original", "fixed"] as const) {
  const { createStoreApp } = await import(pathToFileURL(join(storeBuilds[label], "app.ts")).href);
  const { app } = createStoreApp({
    paypal: { clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, apiBase: proxy.url },
    openai: { apiKey: config.openaiApiKey, model: config.openaiModel },
  });
  serve({ fetch: app.fetch, port: ports[label] });
  console.log(`Store (${label.padEnd(8)}) http://localhost:${ports[label]}`);
}
