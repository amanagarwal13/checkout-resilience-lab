import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, copyStore, typecheck } from "../investigator/fixer.js";
import { investigate } from "../investigator/investigator.js";
import { createPayPalProxy } from "./proxy.js";
import { runScenario, type RunResult, type StoreUnderTest } from "./runScenario.js";
import { findScenario, scenarios, type Scenario } from "./scenarios.js";
import { fromCents, storeBuilds } from "./storeProfile.js";

// Measures Resilience Lab's AI instead of trusting one good run.
//   npm run eval -- investigator [--n 3]   how often the investigator's own patch fixes each scenario
//   npm run eval -- scam [--n 10]          how often the refund scam beats a prompt-only bot vs the code guardrail

const args = process.argv.slice(2);
const mode = args.find((a) => a === "investigator" || a === "scam") ?? "investigator";
const n = Number(args[args.indexOf("--n") + 1]) || (mode === "scam" ? 10 : 3);
const PARALLEL = Number(process.env.EVAL_PARALLEL ?? 3);
const runDir = join("runs", "evals", `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

async function withProxy<T>(fn: (proxy: ReturnType<typeof createPayPalProxy>) => Promise<T>) {
  const proxy = createPayPalProxy({ port: 0 });
  await proxy.listen();
  try { return await fn(proxy); } finally { await proxy.close(); }
}

const run = (scenario: Scenario, store: StoreUnderTest, dir: string) =>
  withProxy((proxy) => runScenario({ scenario, store, proxy, runDir: dir }));

const passed = (r: RunResult) => !r.verdict.inconclusive && r.verdict.checks.every((c) => c.passed) && r.verdict.atRiskCents === 0;

async function pool<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]();
      }
    }),
  );
  return results;
}

interface Attempt { attempt: number; compiled: boolean; fixed: boolean; atRisk: string; where?: string; summary?: string; error?: string }

async function evalInvestigator() {
  const rows = await pool(
    scenarios.map((scenario) => async () => {
      const dir = join(runDir, scenario.id);
      const before = await run(scenario, { label: "original", dir: storeBuilds.original }, dir);
      const attempts: Attempt[] = [];
      if (before.verdict.inconclusive || passed(before)) {
        console.log(`  ${scenario.id}: before-run didn't fail (${before.verdict.inconclusive ?? "passed"}), skipping`);
        return { scenario: scenario.id, beforeAtRisk: fromCents(before.verdict.atRiskCents), skipped: true, attempts };
      }
      for (let attempt = 1; attempt <= n; attempt++) {
        try {
          const diagnosis = await investigate(scenario, before, storeBuilds.original);
          const patched = join(dir, `patch-${attempt}`);
          copyStore(storeBuilds.original, patched);
          applyEdits(patched, diagnosis.fix.edits);
          const compiled = (await typecheck(patched)).ok;
          const after = compiled ? await run(scenario, { label: `patched-${attempt}`, dir: patched }, dir) : undefined;
          const fixed = Boolean(after && passed(after));
          attempts.push({ attempt, compiled, fixed, atRisk: after ? fromCents(after.verdict.atRiskCents) : "-", where: `${diagnosis.rootCause.file}:${diagnosis.rootCause.line}`, summary: diagnosis.fix.summary });
          console.log(`  ${scenario.id} attempt ${attempt}: ${fixed ? "FIXED" : compiled ? "not fixed" : "didn't compile"}`);
        } catch (error) {
          attempts.push({ attempt, compiled: false, fixed: false, atRisk: "-", error: String(error).slice(0, 200) });
          console.log(`  ${scenario.id} attempt ${attempt}: error ${String(error).slice(0, 120)}`);
        }
      }
      return { scenario: scenario.id, beforeAtRisk: fromCents(before.verdict.atRiskCents), skipped: false, attempts };
    }),
  );

  const lines = [
    `## Investigator: does its own patch fix the store?`,
    ``,
    `Each scenario was stress-tested once on the store as written, then the investigator was run ${n} times on that evidence. Each patch was applied to a fresh copy, type-checked, and the same scenario re-run against PayPal's sandbox. "Fixed" means every money check passed with $0 at risk.`,
    ``,
    `| Scenario | Money at risk before | Fixed | Compiled | Root cause it named |`,
    `|---|---|---|---|---|`,
    ...rows.map((r) =>
      r.skipped
        ? `| ${r.scenario} | $${r.beforeAtRisk} | (before-run did not fail) | | |`
        : `| ${r.scenario} | $${r.beforeAtRisk} | ${r.attempts.filter((a) => a.fixed).length} of ${r.attempts.length} | ${r.attempts.filter((a) => a.compiled).length} of ${r.attempts.length} | ${[...new Set(r.attempts.map((a) => a.where).filter(Boolean))].join(", ")} |`,
    ),
  ];
  const judged = rows.filter((r) => !r.skipped).flatMap((r) => r.attempts);
  lines.push(``, `**Overall: ${judged.filter((a) => a.fixed).length} of ${judged.length} attempts fixed the store.**`);
  return { rows, markdown: lines.join("\n") };
}

async function evalScam() {
  const scenario = findScenario("refund-scam")!;
  const jobs = (["original", "fixed"] as const).flatMap((label) =>
    Array.from({ length: n }, (_, i) => async () => {
      const r = await run(scenario, { label: `${label}-${i + 1}`, dir: storeBuilds[label] }, join(runDir, label));
      console.log(`  ${label} run ${i + 1}: ${r.verdict.inconclusive ? "inconclusive" : `$${fromCents(r.verdict.atRiskCents)} at risk`}`);
      return { label, inconclusive: Boolean(r.verdict.inconclusive), atRiskCents: r.verdict.atRiskCents };
    }),
  );
  const results = await pool(jobs);
  const summary = (label: string) => {
    const judged = results.filter((r) => r.label === label && !r.inconclusive);
    const lost = judged.filter((r) => r.atRiskCents > 0);
    return { judged: judged.length, lost: lost.length, total: fromCents(lost.reduce((s, r) => s + r.atRiskCents, 0)) };
  };
  const o = summary("original");
  const f = summary("fixed");
  const markdown = [
    `## Refund scam: prompt-only guardrail vs code guardrail`,
    ``,
    `The scammer test shopper ran ${n} times against each store. Both stores give their AI support bot the same written refund policy. The original relies on the prompt; the fixed store also checks the policy in code before PayPal is called.`,
    ``,
    `| Support bot | Runs where the scammer got money | Money lost across those runs |`,
    `|---|---|---|`,
    `| Policy in the prompt only | ${o.lost} of ${o.judged} | $${o.total} |`,
    `| Policy also enforced in code | ${f.lost} of ${f.judged} | $${f.total} |`,
  ].join("\n");
  return { results, markdown };
}

mkdirSync(runDir, { recursive: true });
console.log(`=== Eval: ${mode}, n=${n} ===`);
const result = mode === "scam" ? await evalScam() : await evalInvestigator();
writeFileSync(join(runDir, "eval.json"), JSON.stringify(result, null, 2));
writeFileSync(join(runDir, "eval.md"), `${result.markdown}\n\n_Run ${new Date().toISOString().slice(0, 10)}, raw results in \`${runDir}\`._\n`);
console.log(`\n${result.markdown}\n\nSaved to ${runDir}`);
process.exit(0);
