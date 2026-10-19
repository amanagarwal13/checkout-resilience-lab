import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createPayPalProxy } from "./lab/proxy.js";
import { createStoreApp, type StoreMode } from "./store/app.js";

// Runs the PayPal proxy and both builds of the demo store for manual browsing.
const proxy = createPayPalProxy({ port: 4010 });
await proxy.listen();
console.log(`PayPal proxy      ${proxy.url}`);

const ports: Record<StoreMode, number> = { original: 4100, fixed: 4101 };
for (const mode of ["original", "fixed"] as const) {
  const { app } = createStoreApp({
    mode,
    paypal: { clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, apiBase: proxy.url },
  });
  serve({ fetch: app.fetch, port: ports[mode] });
  console.log(`Store (${mode.padEnd(8)}) http://localhost:${ports[mode]}`);
}
