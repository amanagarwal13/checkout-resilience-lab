import { join } from "node:path";
import { createPayPalProxy } from "./proxy.js";
import { runScenario, type RunResult } from "./runScenario.js";
import { scenarios } from "./scenarios.js";
import { fromCents, storeBuilds } from "./storeProfile.js";

// Usage: npm run crash -- [scenario ...] [original|fixed]
const args = process.argv.slice(2);
const ids = scenarios.map((s) => s.id);
const selected = args.some((a) => ids.includes(a)) ? scenarios.filter((s) => args.includes(s.id)) : scenarios;
const labels = (["original", "fixed"] as const).filter((m) => !args.some((a) => a === "original" || a === "fixed") || args.includes(m));

const runDir = join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
const proxy = createPayPalProxy({ port: 4020 });
await proxy.listen();

const results: RunResult[] = [];
let port = 4200;
for (const scenario of selected) {
  for (const label of labels) {
    console.log(`\n=== ${scenario.title} · store "${label}" ===`);
    const result = await runScenario({
      scenario,
      store: { label, dir: storeBuilds[label] },
      proxy,
      port: port++,
      runDir,
      onEvent: (e) => {
        if (e.type === "step") {
          const shown = e.step.tool === "view_shop" ? "" : JSON.stringify(e.step.args);
          console.log(`    ${scenario.persona.name} → ${e.step.tool}(${shown})\n      ${e.step.result.slice(0, 160)}`);
        }
        if (e.type === "paypal" && e.entry.fault) console.log(`    [DummyRun] ${e.entry.fault}`);
      },
    });
    if (result.verdict.inconclusive) console.log(`  INCONCLUSIVE  ${result.verdict.inconclusive}`);
    else for (const c of result.verdict.checks) console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
    for (const r of result.verdict.atRisk) console.log(`  AT RISK  ${r.reason}: $${fromCents(r.cents)}`);
    console.log(`  Safety rating ${result.verdict.rating}/5 · money at risk $${fromCents(result.verdict.atRiskCents)}`);
    results.push(result);
  }
}

console.log("\n=== Summary ===");
for (const r of results) {
  const passed = r.verdict.checks.filter((c) => c.passed).length;
  const outcome = r.verdict.inconclusive ? "INCONCLUSIVE" : `${passed}/${r.verdict.checks.length} checks · ${r.verdict.rating}/5 · at risk $${fromCents(r.verdict.atRiskCents)}`;
  console.log(`  ${r.scenario.padEnd(14)} ${r.store.padEnd(8)} ${outcome}`);
}
console.log(`  Reports and video: ${runDir}`);
await proxy.close();

// --strict: fail (for CI) when any judged test has a failed money check.
const failed = results.filter((r) => !r.verdict.inconclusive && r.verdict.checks.some((c) => !c.passed));
if (args.includes("--strict") && failed.length) {
  console.log(`\n${failed.length} test(s) failed a money check.`);
  process.exit(1);
}
process.exit(0);
