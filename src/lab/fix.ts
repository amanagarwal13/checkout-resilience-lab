import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromCents } from "./storeProfile.js";
import { applyEdits, copyStore, describeEdits, typecheck } from "../investigator/fixer.js";
import { investigate } from "../investigator/investigator.js";
import { createPayPalProxy } from "./proxy.js";
import { runScenario, type RunResult } from "./runScenario.js";
import { findScenario, scenarios } from "./scenarios.js";
import { storeBuilds } from "./storeProfile.js";

// Usage: npm run fix -- <scenario>
// Stress-test the original store, let the AI investigator find and fix the
// bug in a copy, then re-run the same scenario against the patched copy.
const scenario = findScenario(process.argv[2] ?? "");
if (!scenario) {
  console.error(`Pick a scenario: ${scenarios.map((s) => s.id).join(", ")}`);
  process.exit(1);
}

const runDir = join("runs", new Date().toISOString().replace(/[:.]/g, "-"));
const proxy = createPayPalProxy({ port: 0 });
await proxy.listen();

function show(label: string, r: RunResult) {
  console.log(`\n[${label}]`);
  if (r.verdict.inconclusive) console.log(`  INCONCLUSIVE  ${r.verdict.inconclusive}`);
  for (const c of r.verdict.checks) console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
  console.log(`  Resilience score ${r.verdict.rating}/5 · money at risk $${fromCents(r.verdict.atRiskCents)}`);
}

console.log(`=== ${scenario.title} ===`);
const before = await runScenario({ scenario, store: { label: "original", dir: storeBuilds.original }, proxy, runDir });
show("Before: original store", before);

if (before.verdict.inconclusive) {
  console.log("\nThe test didn't get far enough to judge the store. Try again.");
} else if (before.verdict.checks.every((c) => c.passed)) {
  console.log("\nNothing to fix: every check passed.");
} else {
  console.log("\n[Investigator] reading the evidence and the store's code…");
  const diagnosis = await investigate(scenario, before, storeBuilds.original);
  console.log(`  Why it broke: ${diagnosis.explanation}`);
  console.log(`  Where: ${diagnosis.rootCause.file}:${diagnosis.rootCause.line}`);
  console.log(`  Fix: ${diagnosis.fix.summary}`);
  console.log(`  PayPal guidance: ${diagnosis.paypalGuidance}`);
  console.log(`\n${describeEdits(diagnosis.fix.edits).replace(/^/gm, "    ")}`);

  const patchedDir = join(runDir, scenario.id, "patched-store");
  copyStore(storeBuilds.original, patchedDir);
  applyEdits(patchedDir, diagnosis.fix.edits);
  const compiled = await typecheck(patchedDir);
  writeFileSync(join(runDir, scenario.id, "diagnosis.json"), JSON.stringify({ ...diagnosis, typecheck: compiled }, null, 2));
  if (!compiled.ok) {
    console.log(`\n  The patch doesn't compile, so Resilience Lab won't run it:\n${compiled.output}`);
  } else {
    console.log("\n  Patch compiles. Re-running the same scenario against the patched store…");
    const after = await runScenario({ scenario, store: { label: "patched", dir: patchedDir }, proxy, runDir });
    show("After: patched store", after);
    console.log(`\n  Resilience score ${before.verdict.rating}/5 → ${after.verdict.rating}/5 · money at risk $${fromCents(before.verdict.atRiskCents)} → $${fromCents(after.verdict.atRiskCents)}`);
  }
}

console.log(`\nReports, video, diagnosis and patched store: ${runDir}`);
await proxy.close();
process.exit(0);
