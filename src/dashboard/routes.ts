import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import type { Hono } from "hono";
import { config } from "../config.js";
import type { Lab } from "../server/lab.js";
import { buildDashboardData } from "./data.js";

const BUNDLE = join("dist", "dashboard.js");
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Bounds the cost of one assistant turn, whatever the browser asks for.
const MAX_OUTPUT_TOKENS = 16_000;

const aiModels = () =>
  config.openaiApiKey ? (process.env.OPENAI_STUDIO_MODELS ?? "gpt-5.6-terra,gpt-5-mini").split(",").map((m) => m.trim()).filter(Boolean) : [];

// Bundles the React + AG Studio dashboard into one browser file.
export async function buildDashboard() {
  await build({
    entryPoints: ["src/dashboard/client/main.tsx"],
    bundle: true,
    minify: process.env.NODE_ENV === "production",
    sourcemap: process.env.NODE_ENV === "production" ? false : "inline",
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    outfile: BUNDLE,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
}

function page() {
  const settings = { licenseKey: process.env.AG_STUDIO_LICENSE_KEY || undefined, aiModels: aiModels() };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout Resilience Lab dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; height: 100%; background: #EDF0EF; color: #1D2327; font: 400 15px/1.5 Archivo, system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 24px; padding: 14px 28px; background: #fff; border-bottom: 1px solid #CDD5D8; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; }
  .target { width: 26px; height: 26px; border-radius: 50%; background: conic-gradient(#15191C 0 25%, #F2C400 0 50%, #15191C 0 75%, #F2C400 0); box-shadow: 0 0 0 2px #15191C inset; }
  .wordmark { font-stretch: 62%; font-weight: 800; font-size: 28px; }
  nav { margin-left: auto; display: flex; gap: 18px; }
  nav a { color: #5A6872; text-decoration: none; font-weight: 600; }
  nav a[aria-current="page"] { color: #1D2327; box-shadow: 0 2px 0 #F2C400; }
  #dashboard { flex: 1; min-height: 0; }
</style></head>
<body>
<header class="bar"><a class="brand" href="/"><span class="target" aria-hidden="true"></span><span class="wordmark">Checkout Resilience Lab</span></a>
<nav><a href="/">Stress tests</a><a href="/dashboard" aria-current="page">Dashboard</a><a href="/agents">Coding agents</a></nav></header>
<div id="dashboard"></div>
<script>window.RESILIENCE_LAB = ${JSON.stringify(settings)};</script>
<script type="module" src="/dashboard.js"></script>
</body></html>`;
}

export function dashboardRoutes(app: Hono, lab: Lab) {
  app.get("/dashboard", (c) => c.html(page()));
  app.get("/dashboard.js", (c) => c.body(readFileSync(BUNDLE), 200, { "Content-Type": "text/javascript; charset=utf-8" }));
  app.get("/api/dashboard/data", (c) => c.json(buildDashboardData(lab.list())));

  // Evidence for the resilience analyst agent: the latest finished test of one scenario.
  app.get("/api/dashboard/explain", (c) => {
    const wanted = (c.req.query("scenario") ?? "").toLowerCase().replace(/[^a-z]/g, "");
    for (const run of lab.list()) {
      for (const lane of run.lanes) {
        const v = lane.result?.verdict;
        if (!v || !lane.scenario.replace(/[^a-z]/g, "").includes(wanted.replace(/[^a-z]/g, "").slice(0, 6))) continue;
        return c.json({
          scenario: lane.scenario,
          run: run.id,
          store: run.store,
          rating: v.rating,
          moneyAtRisk: v.atRisk.map((r) => ({ reason: r.reason, usd: r.cents / 100 })),
          failedChecks: v.checks.filter((x) => !x.passed),
          injectedFaults: lane.result!.proxyLog.filter((e) => e.fault).map((e) => ({ call: `${e.method} ${e.path}`, fault: e.fault })),
          diagnosis: lane.fix?.diagnosis
            ? { explanation: lane.fix.diagnosis.explanation, where: `${lane.fix.diagnosis.rootCause.file}:${lane.fix.diagnosis.rootCause.line}`, fix: lane.fix.diagnosis.fix.summary }
            : "Not investigated yet. Use Investigate and fix on the Stress tests page.",
          afterFix: lane.fix?.after ? { rating: lane.fix.after.verdict.rating, usdAtRisk: lane.fix.after.verdict.atRiskCents / 100 } : null,
        });
      }
    }
    return c.json({ error: "No finished test for that scenario yet" }, 404);
  });

  // AG Studio's OpenAI adapter runs in the browser; this adds the key on the server.
  app.post("/api/ai/responses", async (c) => {
    if (!config.openaiApiKey) return c.json({ error: { message: "The assistant isn't configured." } }, 503);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: { message: "Request body must be JSON." } }, 400);
    const models = aiModels();
    const model = typeof body.model === "string" && body.model ? body.model : models[0];
    if (!models.includes(model)) return c.json({ error: { message: `Model "${model}" isn't enabled.` } }, 400);
    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openaiApiKey}` },
      body: JSON.stringify({ ...body, model, max_output_tokens: MAX_OUTPUT_TOKENS }),
      signal: c.req.raw.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
    });
  });
}
