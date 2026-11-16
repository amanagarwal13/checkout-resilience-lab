import { exec } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Edit } from "./investigator.js";

const run = promisify(exec);
const ROOT_TSCONFIG = resolve("tsconfig.json").replaceAll("\\", "/");

// The investigator never touches the original source: its edits go into a copy.
// By default the copy is every .ts file in the folder (the Ember and Wick
// layout); pass files, relative to the folder, for other stores.
export function copyStore(fromDir: string, toDir: string, files?: string[]) {
  mkdirSync(toDir, { recursive: true });
  for (const f of files ?? readdirSync(fromDir).filter((f) => f.endsWith(".ts"))) {
    mkdirSync(dirname(join(toDir, f)), { recursive: true });
    copyFileSync(join(fromDir, f), join(toDir, f));
  }
}

export function applyEdits(dir: string, edits: Edit[]) {
  for (const e of edits) {
    const path = join(dir, e.file);
    const source = readFileSync(path, "utf8");
    if (source.split(e.find).length - 1 !== 1) throw new Error(`Edit for ${e.file} no longer matches exactly once`);
    writeFileSync(path, source.replace(e.find, () => e.replace));
  }
}

// A patch has to compile before Resilience Lab will run shoppers against it.
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

// Plain-JavaScript stores have no compiler, so a patch must at least parse.
export async function syntaxCheck(dir: string, files: string[]): Promise<{ ok: boolean; output: string }> {
  const problems: string[] = [];
  for (const f of files.filter((f) => f.endsWith(".js"))) {
    try {
      await run(`"${process.execPath}" --check "${join(dir, f)}"`, { timeout: 30_000 });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      problems.push(`${f}:\n${`${e.stdout ?? ""}${e.stderr ?? ""}`.trim()}`);
    }
  }
  return { ok: problems.length === 0, output: problems.join("\n\n") };
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
