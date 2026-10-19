import { exec } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Edit } from "./investigator.js";

const run = promisify(exec);
const ROOT_TSCONFIG = resolve("tsconfig.json").replaceAll("\\", "/");

// The investigator never touches the original source: its edits go into a copy.
export function copyStore(fromDir: string, toDir: string) {
  mkdirSync(toDir, { recursive: true });
  for (const f of readdirSync(fromDir).filter((f) => f.endsWith(".ts"))) copyFileSync(join(fromDir, f), join(toDir, f));
}

export function applyEdits(dir: string, edits: Edit[]) {
  for (const e of edits) {
    const path = join(dir, e.file);
    const source = readFileSync(path, "utf8");
    if (source.split(e.find).length - 1 !== 1) throw new Error(`Edit for ${e.file} no longer matches exactly once`);
    writeFileSync(path, source.replace(e.find, () => e.replace));
  }
}

// A patch has to compile before DummyRun will run shoppers against it.
export async function typecheck(dir: string): Promise<{ ok: boolean; output: string }> {
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: ROOT_TSCONFIG, include: ["./*.ts"] }, null, 2));
  try {
    await run(`npx tsc --noEmit -p "${join(dir, "tsconfig.json")}"`, { timeout: 120_000 });
    return { ok: true, output: "" };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() };
  }
}

// A compact before/after view of each edit for people reading the fix.
export function describeEdits(edits: Edit[]) {
  return edits
    .map((e) => {
      const minus = e.find.split("\n").map((l) => `- ${l}`).join("\n");
      const plus = e.replace.split("\n").map((l) => `+ ${l}`).join("\n");
      return `${e.file}\n${minus}\n${plus}`;
    })
    .join("\n\n");
}
