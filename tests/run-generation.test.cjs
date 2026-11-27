const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

test("a background generation throw marks its run failed with the reason", async () => {
  const source = ts.transpileModule(readFileSync("lib/run-generation.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let query;
  const exports = {};
  new Function("require", "exports", source)((name) => {
    if (name === "@/lib/db") return { sql: async (strings, ...values) => { query = { text: strings.join("?"), values }; } };
    throw new Error(`unexpected import ${name}`);
  }, exports);
  const original = console.error;
  console.error = () => {};
  try {
    await exports.runGenerationInBackground("run-1", async () => { throw new Error("request timed out"); });
  } finally {
    console.error = original;
  }
  assert.match(query.text, /status = 'failed'/);
  assert.match(query.text, /finished_at = now\(\)/);
  assert.equal(query.values[0], "request timed out");
  assert.equal(query.values[1], "run-1");
});
