import { createServer, type IncomingMessage, type Server } from "node:http";
import { PAYPAL_SANDBOX_API } from "../config.js";

// A fault to inject into matching PayPal calls.
// "delay-response": forward the call so PayPal really processes it, then hold
// PayPal's answer back. To the store it looks like a timeout, even though the
// money already moved.
export interface FaultRule {
  name: string;
  method: string;
  path: RegExp;
  action: "delay-response";
  delayMs: number;
  times: number;
}

export interface ProxyLogEntry {
  at: string;
  method: string;
  path: string;
  requestId?: string;
  status: number;
  debugId?: string;
  fault?: string;
  summary?: Record<string, string>;
}

const HOP_HEADERS = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "keep-alive"]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Pull the IDs that matter for money checks out of PayPal's response.
function summarize(path: string, body: string): Record<string, string> | undefined {
  try {
    const json = JSON.parse(body);
    if (/^\/v2\/checkout\/orders\/?$/.test(path)) return { orderId: json.id, status: json.status };
    if (/\/v2\/checkout\/orders\/[^/]+\/capture$/.test(path)) {
      const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
      return { orderId: json.id, status: json.status, captureId: capture?.id, amount: capture?.amount?.value };
    }
    if (/\/v2\/payments\/captures\/[^/]+\/refund$/.test(path)) return { refundId: json.id, status: json.status, amount: json.amount?.value };
  } catch {
    // Not JSON (for example the OAuth token form response); nothing to summarize.
  }
  return undefined;
}

export function createPayPalProxy({ port, upstream = PAYPAL_SANDBOX_API }: { port: number; upstream?: string }) {
  let rules: FaultRule[] = [];
  const log: ProxyLogEntry[] = [];

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "DUMMYRUN_PROXY_ERROR", message: String(error) }));
    });
  });

  async function handle(req: IncomingMessage, res: import("node:http").ServerResponse) {
    const method = req.method ?? "GET";
    const path = req.url ?? "/";
    const body = await readBody(req);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_HEADERS.has(key) && typeof value === "string") headers.set(key, value);
    }

    const upstreamRes = await fetch(upstream + path, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(body),
    });
    const text = await upstreamRes.text();

    const rule = rules.find((r) => r.times > 0 && r.method === method && r.path.test(path));
    if (rule) rule.times -= 1;

    log.push({
      at: new Date().toISOString(),
      method,
      path: path.split("?")[0],
      requestId: req.headers["paypal-request-id"] as string | undefined,
      status: upstreamRes.status,
      debugId: upstreamRes.headers.get("paypal-debug-id") ?? undefined,
      fault: rule ? `${rule.name}: answer held ${rule.delayMs / 1000}s after PayPal processed it` : undefined,
      summary: summarize(path.split("?")[0], text),
    });

    if (rule) await new Promise((r) => setTimeout(r, rule.delayMs));
    if (res.destroyed || req.socket.destroyed) return;

    const outHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) outHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(text);
  }

  return {
    url: `http://localhost:${port}`,
    log,
    listen: () => new Promise<void>((resolve) => server.listen(port, resolve)),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
    setRules(next: FaultRule[]) { rules = next.map((r) => ({ ...r })); },
    reset() { rules = []; log.length = 0; },
  };
}

export type PayPalProxy = ReturnType<typeof createPayPalProxy>;
