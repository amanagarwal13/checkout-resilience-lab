import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildDashboard, dashboardRoutes } from "../dashboard/routes.js";
import { createLab, type StoreLabel } from "./lab.js";
import { page } from "./ui.js";

const lab = createLab();
const app = new Hono();
await buildDashboard();
dashboardRoutes(app, lab);

app.get("/", (c) => c.html(page()));
app.get("/api/scenarios", (c) => c.json(lab.scenarios()));
app.get("/api/runs", (c) =>
  c.json(lab.list().map((r) => ({ id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, store: r.store, lanes: r.lanes.map((l) => ({ scenario: l.scenario, status: l.status, verdict: l.result?.verdict })) }))),
);
app.get("/api/runs/:id", (c) => {
  const run = lab.get(c.req.param("id"));
  return run ? c.json(run) : c.json({ error: "Run not found" }, 404);
});

app.post("/api/runs", async (c) => {
  const body = await c.req.json<{ store?: StoreLabel; scenarios?: string[] }>().catch(() => ({}) as { store?: StoreLabel; scenarios?: string[] });
  const store: StoreLabel = body.store === "fixed" ? "fixed" : "original";
  try {
    return c.json(lab.start(store, body.scenarios), 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
});

app.post("/api/runs/:id/lanes/:lane/fix", (c) => {
  const { id, lane } = c.req.param();
  const run = lab.get(id);
  if (!run?.lanes.some((l) => l.scenario === lane && l.result)) return c.json({ error: "That test hasn't finished" }, 400);
  void lab.fix(id, lane);
  return c.json({ ok: true }, 202);
});

app.get("/api/runs/:id/lanes/:lane/frame", (c) => {
  const jpeg = lab.frame(c.req.param("id"), c.req.param("lane"));
  if (!jpeg) return c.body(null, 204);
  return c.body(Buffer.from(jpeg, "base64"), 200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
});

app.get("/api/runs/:id/lanes/:lane/video", (c) => {
  const run = lab.get(c.req.param("id"));
  const lane = run?.lanes.find((l) => l.scenario === c.req.param("lane"));
  const which = c.req.query("which") === "after" ? lane?.fix?.after : lane?.result;
  const path = which?.videoPath;
  if (!path || !existsSync(path)) return c.text("No recording", 404);
  return c.body(readFileSync(path), 200, { "Content-Type": "video/webm" });
});

// Live updates for one run. Frames are fetched separately, so this stays small.
app.get("/api/runs/:id/stream", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    const run = lab.get(id);
    if (!run) return;
    await stream.writeSSE({ event: "snapshot", data: JSON.stringify(run) });
    const queue: string[] = [];
    let wake: (() => void) | undefined;
    const unsubscribe = lab.subscribe(id, (e) => {
      if ("event" in e && e.event.type === "frame") return;
      if ("fixEvent" in e && e.fixEvent.type === "frame") return;
      queue.push(JSON.stringify(e));
      wake?.();
    });
    stream.onAbort(() => { unsubscribe(); wake?.(); });
    while (!stream.aborted) {
      while (queue.length) await stream.writeSSE({ event: "update", data: queue.shift()! });
      await new Promise<void>((resolve) => { wake = resolve; setTimeout(resolve, 15_000); });
      if (!queue.length && !stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
    }
  });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`DummyRun lab on http://localhost:${port}`));
