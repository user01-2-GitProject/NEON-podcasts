const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const compiled = ts.transpileModule(readFileSync("lib/tricky-words.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = {};
new Function("require", "exports", compiled)(() => { throw new Error("no imports expected"); }, m);
const { spotTrickyWords } = m;

const sample = `Tonight the Mavericks beat Denver. Luka Dončić had 12 rebounds and Victor Wembanyama
blocked four shots. Giannis Antetokounmpo sat out. Ohtani drove in 3 RBI. The NEON show
loves Deep Fucking Value. The NBA and the USA are fine. Buy $GME? 0DTE options too.`;

test("spots the problem words from jimmy's shows", () => {
  const terms = spotTrickyWords(sample).map((w) => w.term);
  for (const t of ["Deep Fucking Value", "rebounds", "Dončić", "Antetokounmpo", "RBI", "NEON", "$GME", "0DTE"]) {
    assert.ok(terms.includes(t), `expected ${t} in ${terms.join(", ")}`);
  }
  for (const t of ["NBA", "USA", "Mavericks", "Denver", "Tonight"]) {
    assert.ok(!terms.includes(t), `did not expect ${t}`);
  }
});

test("gives first guesses and puts never-say words first", () => {
  const list = spotTrickyWords(sample);
  const by = Object.fromEntries(list.map((w) => [w.term, w]));
  assert.equal(list[0].kind, "never_say");
  assert.equal(by["Deep Fucking Value"].say_as, "Deep Freaking Value");
  assert.equal(by.rebounds.say_as, "REE-bounds");
  assert.equal(by.RBI.say_as, "R B I");
  assert.equal(by.NEON.say_as, "neon");
  assert.equal(by["0DTE"].say_as, "0 D T E");
  assert.equal(by["Dončić"].say_as, "Doncic");
});

test("skips words already on the list, case-insensitively", () => {
  const terms = spotTrickyWords(sample, ["rbi", "NEON"]).map((w) => w.term);
  assert.ok(!terms.includes("RBI"));
  assert.ok(!terms.includes("NEON"));
});

test("a shouted sentence isn't a pile of short forms", () => {
  assert.deepEqual(spotTrickyWords("THIS IS THE BIGGEST GAME EVER").map((w) => w.term), []);
});
