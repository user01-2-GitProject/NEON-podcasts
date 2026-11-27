const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync("lib/reap-runs.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const reaper = {};
new Function("require", "exports", source)((name) => {
  if (name === "@/lib/db") return { sql: async () => [] };
  throw new Error(`unexpected import ${name}`);
}, reaper);

test("reaper fails only runs that are still running and older than ten minutes", async () => {
  let query;
  const db = async (strings, ...values) => { query = { text: strings.join("?"), values }; return []; };
  await reaper.reapStuckRuns(db);
  assert.match(query.text, /status = 'failed'/);
  assert.match(query.text, /where status = 'running'/);
  assert.match(query.text, /scheduled_for is null/);
  assert.match(query.text, /coalesce\(heartbeat_at, started_at\) < now\(\) - interval '10 minutes'/);
  assert.match(query.text, /finished_at = now\(\)/);
});
