import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Plays the coding agent's part over MCP: crash-test, apply the proposed fix
// to the working copy, crash-test again. Restore the store afterwards with
//   git checkout -- stores/ember-and-wick/original
// Usage: npx tsx scripts/mcp-loop.ts [scenario] [--url http://localhost:3000/mcp]

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) ?? "refund-retry";
const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3000/mcp";

const client = new Client({ name: "dummyrun-mcp-loop", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

async function call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0]?.text ?? "";
  if (result.isError) throw new Error(`${name}: ${text}`);
  try { return JSON.parse(text); } catch { return text as T; }
}

async function crashTest() {
  const { run_id, watch_url } = await call("start_crash_test", { scenarios: [scenario] });
  console.log(`  watching at ${watch_url}`);
  let summary = await call("get_crash_test", { run_id, wait_seconds: 50 });
  while (summary.status !== "finished") summary = await call("get_crash_test", { run_id, wait_seconds: 50 });
  const test = summary.tests[0];
  console.log(`  ${test.scenario}: ${test.safety_rating ?? "inconclusive"}, $${test.money_at_risk_usd ?? "?"} at risk`);
  for (const c of test.failed_checks ?? []) console.log(`    - ${c}`);
  return { run_id, test };
}

console.log("Tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));

console.log(`\n1. Crash-test ${scenario}`);
const before = await crashTest();
if (!before.test.failed_checks?.length) {
  console.log("Nothing failed, so there is nothing to fix.");
  process.exit(0);
}

console.log("\n2. Diagnose");
const diagnosis = await call("diagnose_failure", { run_id: before.run_id, scenario });
console.log(`  ${diagnosis.explanation}\n  at ${diagnosis.where}\n  fix: ${diagnosis.fix}`);

console.log("\n3. Apply the edits to the working copy");
for (const edit of diagnosis.edits as { file: string; find: string; replace: string }[]) {
  const source = readFileSync(edit.file, "utf8");
  if (source.split(edit.find).length !== 2) throw new Error(`The edit for ${edit.file} doesn't match exactly once`);
  writeFileSync(edit.file, source.replace(edit.find, () => edit.replace));
  console.log(`  edited ${edit.file}`);
}

console.log(`\n4. Crash-test ${scenario} again`);
const after = await crashTest();
console.log(after.test.failed_checks?.length ? "\nStill failing." : "\nRed to green: every money check passes.");
await client.close();
