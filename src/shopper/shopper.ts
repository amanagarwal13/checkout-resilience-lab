import OpenAI from "openai";
import { chromium } from "playwright";
import { config } from "../config.js";
import { buyItems, chatWithSupport, requestRefund, viewShop, type CheckoutBehaviour } from "./browserTools.js";

export interface Persona {
  name: string;
  instructions: string;
}

export interface ShopperStep {
  at: string;
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ShopperRun {
  persona: string;
  steps: ShopperStep[];
  orderId?: string;
  refundRequests: { sku: string; attempts: number }[];
  finalNote?: string;
  videoPath?: string;
}

// The AI decides what to do; these tools do the clicking in a real browser.
const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "view_shop",
    description: "Open the shop and list the products with their SKUs and prices.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "buy_items",
    description: "Put items in the cart and pay by card. Returns the order ID when payment succeeds.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { sku: { type: "string" }, quantity: { type: "integer" } },
            required: ["sku", "quantity"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "request_refund",
    description: "Ask the shop to refund one item from a paid order. Returns the shop's response.",
    parameters: {
      type: "object",
      properties: { order_id: { type: "string" }, sku: { type: "string" }, reason: { type: "string" } },
      required: ["order_id", "sku", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "chat_with_support",
    description: "Send one message to the shop's support chat for an order. Returns the support assistant's reply.",
    parameters: {
      type: "object",
      properties: { order_id: { type: "string" }, message: { type: "string" } },
      required: ["order_id", "message"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "finish",
    description: "Call only when every step of your task is done, or you have given up after retrying. Summarize what happened in one sentence.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function runShopper(opts: {
  storeUrl: string;
  persona: Persona;
  behaviour?: CheckoutBehaviour;
  videoDir?: string;
  maxSteps?: number;
  onStep?: (step: ShopperStep) => void;
  // Live JPEG frames of the shopper's browser, about one a second.
  onFrame?: (jpegBase64: string) => void;
}): Promise<ShopperRun> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const viewport = { width: 1100, height: 760 };
  const context = await browser.newContext({ viewport, ...(opts.videoDir ? { recordVideo: { dir: opts.videoDir, size: viewport } } : {}) });
  const page = await context.newPage();

  let streaming = Boolean(opts.onFrame);
  const frames = (async () => {
    while (streaming) {
      const shot = await page.screenshot({ type: "jpeg", quality: 50 }).catch(() => null);
      if (shot && streaming) opts.onFrame?.(shot.toString("base64"));
      await new Promise((r) => setTimeout(r, 1_000));
    }
  })();

  const run: ShopperRun = { persona: opts.persona.name, steps: [], refundRequests: [] };

  async function callTool(name: string, args: any): Promise<string> {
    try {
      switch (name) {
        case "view_shop":
          return JSON.stringify(await viewShop(page, opts.storeUrl));
        case "buy_items": {
          const order = await buyItems(page, opts.storeUrl, args.items, opts.behaviour);
          run.orderId = order.orderId;
          return `Payment succeeded. ${order.summary}`;
        }
        case "request_refund": {
          const entry = run.refundRequests.find((r) => r.sku === args.sku);
          if (entry) entry.attempts += 1;
          else run.refundRequests.push({ sku: args.sku, attempts: 1 });
          return await requestRefund(page, opts.storeUrl, args.order_id, args.sku, args.reason);
        }
        case "chat_with_support":
          return await chatWithSupport(page, opts.storeUrl, args.order_id, args.message);
        case "finish":
          run.finalNote = args.summary;
          return "ok";
        default:
          return `Unknown tool ${name}`;
      }
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  try {
    let response = await openai.responses.create({
      model: config.openaiModel,
      reasoning: { effort: "low" },
      instructions: opts.persona.instructions,
      input: "Start now.",
      tools,
      tool_choice: "required",
    });

    for (let step = 0; step < (opts.maxSteps ?? 12) && !run.finalNote; step++) {
      const calls = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call");
      if (calls.length === 0) break;

      const outputs: OpenAI.Responses.ResponseInputItem[] = [];
      for (const call of calls) {
        const args = JSON.parse(call.arguments || "{}");
        const result = await callTool(call.name, args);
        const step: ShopperStep = { at: new Date().toISOString(), tool: call.name, args, result };
        run.steps.push(step);
        opts.onStep?.(step);
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: result });
      }
      if (run.finalNote) break;
      response = await openai.responses.create({
        model: config.openaiModel,
        reasoning: { effort: "low" },
        // Instructions are not carried over by previous_response_id, so resend them every turn.
        instructions: opts.persona.instructions,
        previous_response_id: response.id,
        input: outputs,
        tools,
        // Agents act through tools until they call finish; no chatting mid-task.
        tool_choice: "required",
      });
    }
  } finally {
    streaming = false;
    await frames;
    await context.close();
    run.videoPath = await page.video()?.path().catch(() => undefined);
    await browser.close();
  }
  return run;
}
