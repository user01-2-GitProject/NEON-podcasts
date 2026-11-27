const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const gen = read("lib/generate.ts");

test("generate imports and calls runFactCheck after runScriptQa", () => {
  assert.match(gen, /import \{ runFactCheck \} from "@\/lib\/fact-check"/);
  const qa = gen.indexOf("await runScriptQa(");
  const fc = gen.indexOf("await runFactCheck({ script: result.script, briefingSnapshot: storedSnapshot })");
  assert.ok(qa > 0 && fc > qa);
});

test("every script_qa write also writes fact_check", () => {
  const qa = gen.match(/script_qa = \$\{qaJson\}/g) || [];
  const fc = gen.match(/fact_check = \$\{fcJson\}/g) || [];
  assert.equal(qa.length, 5);
  assert.equal(fc.length, qa.length);
});

test("auto publish is conditional on fact_check_council", () => {
  assert.match(gen, /autoStatus = show\.fact_check_council \? "draft" : "published"/);
  const stmts = gen.match(/status = \$\{autoStatus\}, published_at = case when \$\{autoStatus\} = 'published' then now\(\) end/g) || [];
  assert.equal(stmts.length, 2);
  assert.doesNotMatch(gen, /status = 'published', published_at = now\(\)/);
});

test("migration and schema carry both columns", () => {
  const mig = read("db/migrations/016_fact_check.sql");
  assert.match(mig, /alter table runs add column if not exists fact_check jsonb/);
  assert.match(mig, /alter table shows add column if not exists fact_check_council boolean not null default false/);
  const schema = read("db/schema.sql");
  assert.match(schema, /fact_check\s+jsonb/);
  assert.match(schema, /fact_check_council boolean not null default false/);
});

test("fact-check sees exactly the stored briefing_snapshot", () => {
  assert.match(gen, /storedSnapshot = `\$\{briefingSnapshot\}/);
  assert.match(gen, /update runs set briefing_snapshot = \$\{storedSnapshot\}/);
});

test("narrate route does not publish council-held episodes", () => {
  const route = read("app/api/episodes/[id]/narrate/route.ts");
  assert.match(route, /s\.fact_check_council/);
  assert.match(route, /fact_check->'council'->>'verdict'/);
  assert.match(route, /status = case when \$\{ep\.hold_for_council\} then status else 'published' end/);
  assert.doesNotMatch(route, /status = 'published', published_at = now\(\)/);
});
