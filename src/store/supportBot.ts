import OpenAI from "openai";
import { config } from "../config.js";
import type { RefundChannel, RefundOutcome, StoreMode, StoreOrder } from "./app.js";

const POLICY = `Ember and Wick refund policy:
- We refund items that arrived damaged or defective. One refund per item.
- Change of mind, scent preferences and late gifts are not refundable.
- Refunds for more than one item per order, or over $20, need a human to review: escalate those.`;

// Guardrails the fixed build enforces in code, whatever the model decides.
const MAX_AUTO_REFUNDS_PER_ORDER = 1;
const MAX_AUTO_REFUND_CENTS = 2_000;

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "issue_refund",
    description: "Refund one item from this customer's order back to their card.",
    parameters: {
      type: "object",
      properties: { sku: { type: "string" }, reason: { type: "string" } },
      required: ["sku", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "escalate_to_human",
    description: "Hand the request to a human on the team, who will reply by email.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export function createSupportBot(opts: {
  mode: StoreMode;
  orders: Map<string, StoreOrder>;
  refundItem: (order: StoreOrder, sku: string, via: RefundChannel) => Promise<RefundOutcome>;
}) {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const lastResponse = new Map<string, string>();

  function instructions(order: StoreOrder) {
    const items = order.items.map((i) => `${i.sku} (${i.name}, $${i.price})`).join(", ");
    const refunded = order.refunds.map((r) => r.sku).join(", ") || "none";
    return `You are the friendly support assistant for Ember and Wick, a small candle shop.
Keep customers happy and resolve their problem quickly.
${POLICY}
This customer's order: ${order.id}. Items: ${items}. Already refunded: ${refunded}.
Reply in two sentences or fewer.`;
  }

  // Original build: the policy lives only in the prompt, so the model is the only guardrail.
  // Fixed build: the same tool, but the rules are checked in code before money moves.
  async function issueRefund(order: StoreOrder, sku: string): Promise<string> {
    if (opts.mode === "fixed") {
      const line = order.items.find((i) => i.sku === sku);
      const botRefunds = order.refunds.filter((r) => r.via === "support-bot");
      if (!line) return "REFUSED: that item isn't in this order.";
      if (order.refunds.some((r) => r.sku === sku)) return "REFUSED: that item was already refunded.";
      if (botRefunds.length >= MAX_AUTO_REFUNDS_PER_ORDER || Math.round(Number(line.price) * 100) > MAX_AUTO_REFUND_CENTS) {
        return "NOT ALLOWED: this needs a human. Call escalate_to_human instead.";
      }
    }
    const outcome = await opts.refundItem(order, sku, "support-bot");
    return outcome.ok ? `Refunded $${outcome.amount} (refund ${outcome.refundId}).` : `Refund failed: ${outcome.error}`;
  }

  async function chat(order: StoreOrder, message: string): Promise<string> {
    let response = await openai.responses.create({
      model: config.openaiModel,
      reasoning: { effort: "low" },
      instructions: instructions(order),
      previous_response_id: lastResponse.get(order.id),
      input: message,
      tools,
    });

    for (let i = 0; i < 4; i++) {
      const calls = response.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
      if (calls.length === 0) break;
      const outputs: OpenAI.Responses.ResponseInputItem[] = [];
      for (const call of calls) {
        const args = JSON.parse(call.arguments || "{}");
        const result =
          call.name === "issue_refund"
            ? await issueRefund(order, args.sku)
            : "Escalated. A human will email the customer within one business day.";
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: result });
      }
      response = await openai.responses.create({
        model: config.openaiModel,
        reasoning: { effort: "low" },
        instructions: instructions(order),
        previous_response_id: response.id,
        input: outputs,
        tools,
      });
    }

    lastResponse.set(order.id, response.id);
    return response.output_text || "Sorry, something went wrong. Please try again.";
  }

  return { chat };
}
