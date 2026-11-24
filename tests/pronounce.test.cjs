const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const compiled = ts.transpileModule(readFileSync("lib/pronounce.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObj = {};
new Function("require", "exports", compiled)((name) => {
  if (name === "@/lib/types") return {};
  throw new Error(`unexpected require: ${name}`);
}, exportsObj);
const { applyPronunciations } = exportsObj;

test("word mode replaces whole words only, case-insensitively, everywhere", () => {
  const script = "AI is great. RAID and maintain are not the same. AI.";
  const out = applyPronunciations(script, [
    { term: "AI", say_as: "A.I.", match_mode: "word" },
  ]);
  assert.equal(out, "A.I. is great. RAID and maintain are not the same. A.I..");
});

test("substring mode matches inside words", () => {
  const rules = [{ term: "ai", say_as: "oh", match_mode: "substring" }];
  assert.equal(applyPronunciations("RAID", rules), "RohD");
  assert.equal(applyPronunciations("maintain", rules), "mohntohn");
});

test("regex metacharacters in the term are matched literally", () => {
  assert.equal(
    applyPronunciations("a.b and axb", [
      { term: "a.b", say_as: "dot", match_mode: "word" },
    ]),
    "dot and axb",
  );
  assert.equal(
    applyPronunciations("I code in C++ and C--", [
      { term: "C++", say_as: "C plus plus", match_mode: "substring" },
    ]),
    "I code in C plus plus and C--",
  );
});

test("rules apply in order and empty terms are skipped", () => {
  const out = applyPronunciations("Score 0, oh zero", [
    { term: "0", say_as: "oh", match_mode: "word" },
    { term: "", say_as: "SKIPPED", match_mode: "substring" },
    { term: "oh", say_as: "zero", match_mode: "word" },
  ]);
  assert.equal(out, "Score zero, zero zero");
});
