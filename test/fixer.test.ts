import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdits, copyStore } from "../src/investigator/fixer.js";
import { validateEdits } from "../src/investigator/investigator.js";

const source = { "app.ts": "const a = 1;\nconst b = 2;\nconst b2 = 2;\n" };

test("edits must name a real file and match exactly once", () => {
  assert.deepEqual(validateEdits([{ file: "app.ts", find: "const a = 1;", replace: "const a = 3;" }], source), []);
  assert.match(validateEdits([{ file: "nope.ts", find: "x", replace: "y" }], source)[0], /does not exist/);
  assert.match(validateEdits([{ file: "app.ts", find: "missing", replace: "y" }], source)[0], /appears 0 times/);
  assert.match(validateEdits([{ file: "app.ts", find: "= 2;", replace: "= 9;" }], source)[0], /appears 2 times/);
});

test("fixes go into a copy and never touch the original store", () => {
  const original = mkdtempSync(join(tmpdir(), "dummyrun-original-"));
  const patched = mkdtempSync(join(tmpdir(), "dummyrun-patched-"));
  writeFileSync(join(original, "app.ts"), source["app.ts"]);

  copyStore(original, patched);
  // "$&" would be a replacement pattern in String.replace; edits must be applied literally.
  applyEdits(patched, [{ file: "app.ts", find: "const a = 1;", replace: "const a = '$&';" }]);

  assert.match(readFileSync(join(patched, "app.ts"), "utf8"), /const a = '\$&';/);
  assert.equal(readFileSync(join(original, "app.ts"), "utf8"), source["app.ts"]);
});
