import { createServer, type IncomingMessage, type Server } from "node:http";
import { PAYPAL_SANDBOX_API } from "../config.js";

// A fault to inject into matching PayPal calls.
// "delay-response": forward the call so PayPal really processes it, then hold
// PayPal's answer back. To the store it looks like a timeout, even though the
// money already moved.
// "mock-response": add PayPal's own negative-testing header so the sandbox
// answers with a real error, such as a declined card.
interface FaultBase { name: string; method: string; path: RegExp; times: number }
export type FaultRule =
  | (FaultBase & { action: "delay-response"; delayMs: number })
  | (FaultBase & { action: "mock-response"; mockCode: string });

function describe(rule: FaultRule) {
  return rule.action === "delay-response"
    ? `${rule.name}: answer held ${rule.delayMs / 1000}s after PayPal processed it`
    : `${rule.name}: PayPal-Mock-Response ${rule.mockCode}`;
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
    if (json.name && json.details?.[0]?.issue) return { error: json.name, issue: json.details[0].issue };
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
  const listeners = new Set<(entry: ProxyLogEntry) => void>();
  function record(entry: ProxyLogEntry) {
    log.push(entry);
    for (const listener of listeners) listener(entry);
  }

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

    const rule = rules.find((r) => r.times > 0 && r.method === method && r.path.test(path));
    if (rule) rule.times -= 1;
    if (rule?.action === "mock-response") {
      headers.set("PayPal-Mock-Response", JSON.stringify({ mock_application_codes: rule.mockCode }));
    }

    const upstreamRes = await fetch(upstream + path, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(body),
    });
    const text = await upstreamRes.text();

    record({
      at: new Date().toISOString(),
      method,
      path: path.split("?")[0],
      requestId: req.headers["paypal-request-id"] as string | undefined,
      status: upstreamRes.status,
      debugId: upstreamRes.headers.get("paypal-debug-id") ?? undefined,
      fault: rule ? describe(rule) : undefined,
      summary: summarize(path.split("?")[0], text),
    });

    if (rule?.action === "delay-response") await new Promise((r) => setTimeout(r, rule.delayMs));
    if (res.destroyed || req.socket.destroyed) return;

    const outHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) outHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(text);
  }

  return {
    // Port 0 picks a free port, so several runs can each have their own proxy.
    get url() {
      const address = server.address();
      return `http://localhost:${typeof address === "object" && address ? address.port : port}`;
    },
    log,
    listen: () => new Promise<void>((resolve) => server.listen(port, resolve)),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
    setRules(next: FaultRule[]) { rules = next.map((r) => ({ ...r })); },
    reset() { rules = []; log.length = 0; },
    onEntry(listener: (entry: ProxyLogEntry) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type PayPalProxy = ReturnType<typeof createPayPalProxy>;
