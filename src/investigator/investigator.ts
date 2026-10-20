import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { config } from "../config.js";
import type { RunResult } from "../lab/runScenario.js";
import type { Scenario } from "../lab/scenarios.js";

export interface Edit { file: string; find: string; replace: string }

export interface Diagnosis {
  explanation: string; // for a shop owner, plain English
  rootCause: { file: string; line: number; snippet: string };
  fix: { summary: string; edits: Edit[] };
  paypalGuidance: string;
  model: string;
}

const REFERENCES_DIR = fileURLToPath(new URL("./references/", import.meta.url));

function references() {
  return readdirSync(REFERENCES_DIR)
    .filter((f) => f.endsWith(".md") && f !== "NOTICE.md")
    .map((f) => `--- ${f} ---\n${readFileSync(join(REFERENCES_DIR, f), "utf8")}`)
    .join("\n\n");
}

export function readStoreSource(storeDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of readdirSync(storeDir).filter((f) => f.endsWith(".ts"))) files[f] = readFileSync(join(storeDir, f), "utf8");
  return files;
}

function numbered(source: string) {
  return source.split("\n").map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join("\n");
}

// Only what the investigator needs: the failed checks, the faults DummyRun
// injected, the PayPal calls and what the shopper saw.
function evidenceSummary(scenario: Scenario, result: RunResult) {
  return JSON.stringify(
    {
      scenario: { id: scenario.id, title: scenario.title, whatDummyRunDid: scenario.summary },
      failedChecks: result.verdict.checks.filter((c) => !c.passed),
      moneyAtRisk: result.verdict.atRisk,
      paypalCalls: result.proxyLog.map((e) => ({
        call: `${e.method} ${e.path}`,
        status: e.status,
        paypalRequestId: e.requestId ?? null,
        injectedFault: e.fault ?? null,
        result: e.summary ?? null,
      })),
      shopperSteps: result.evidence.shopper.steps.map((s) => ({ tool: s.tool, args: s.args, shopSaid: s.result.slice(0, 300) })),
    },
    null,
    2,
  );
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["explanation", "rootCause", "fix", "paypalGuidance"],
  properties: {
    explanation: { type: "string", description: "Two or three plain-English sentences for a shop owner: what went wrong and what it cost." },
    rootCause: {
      type: "object",
      additionalProperties: false,
      required: ["file", "snippet"],
      properties: {
        file: { type: "string" },
        snippet: { type: "string", description: "An exact, contiguous snippet copied from the file that contains the bug." },
      },
    },
    fix: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "edits"],
      properties: {
        summary: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["file", "find", "replace"],
            properties: {
              file: { type: "string" },
              find: { type: "string", description: "Exact text copied from the file, unique within it, without line-number prefixes." },
              replace: { type: "string" },
            },
          },
        },
      },
    },
    paypalGuidance: { type: "string", description: "The PayPal guidance the fix follows, citing the reference file." },
  },
} as const;

const INSTRUCTIONS = `You are DummyRun's investigator. DummyRun crash-tested a PayPal store with AI test shoppers and injected realistic failures. A money check failed.
Find the root cause in the store's source code and write the smallest correct fix.
Rules:
- Base the diagnosis on the evidence: failed checks, PayPal calls (with any injected fault) and what the shopper saw.
- The fix must use the PayPal Server SDK already in the code and follow the PayPal references provided.
- Protections that stop money moving wrongly belong in server code, not in prompts or the browser alone.
- Each edit's "find" must be copied exactly from the file (no line-number prefixes) and appear exactly once in it.
- Keep the store's behaviour for honest customers the same. Don't rename exports or change function signatures.`;

// Every edit must name a real file and match exactly one place in it.
export function validateEdits(edits: Edit[], source: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const e of edits) {
    const file = source[e.file];
    if (file === undefined) { problems.push(`File ${e.file} does not exist.`); continue; }
    const count = file.split(e.find).length - 1;
    if (count !== 1) problems.push(`In ${e.file}, this "find" text appears ${count} times (must be exactly 1): ${e.find.slice(0, 120)}`);
  }
  return problems;
}

export async function investigate(scenario: Scenario, result: RunResult, storeDir: string): Promise<Diagnosis> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const model = config.openaiInvestigatorModel;
  const source = readStoreSource(storeDir);
  const sourceText = Object.entries(source).map(([f, s]) => `=== ${f} ===\n${numbered(s)}`).join("\n\n");

  let input = `EVIDENCE\n${evidenceSummary(scenario, result)}\n\nPAYPAL REFERENCES\n${references()}\n\nSTORE SOURCE\n${sourceText}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await openai.responses.create({
      model,
      reasoning: { effort: "medium" },
      instructions: INSTRUCTIONS,
      input,
      text: { format: { type: "json_schema", name: "diagnosis", schema, strict: true } },
    });
    const parsed = JSON.parse(response.output_text) as Omit<Diagnosis, "model" | "rootCause"> & { rootCause: { file: string; snippet: string } };
    const problems = validateEdits(parsed.fix.edits, source);
    if (problems.length === 0) {
      const file = source[parsed.rootCause.file] ?? "";
      const index = file.indexOf(parsed.rootCause.snippet);
      const line = index >= 0 ? file.slice(0, index).split("\n").length : 0;
      return { ...parsed, rootCause: { ...parsed.rootCause, line }, model };
    }
    input += `\n\nYOUR PREVIOUS ANSWER COULD NOT BE APPLIED:\n${problems.join("\n")}\nReturn the full answer again with exact "find" text.`;
  }
  throw new Error("The investigator could not produce edits that apply cleanly");
}
