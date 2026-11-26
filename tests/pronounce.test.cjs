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

test("one pass: a respelling is never changed again, and empty terms are skipped", () => {
  const out = applyPronunciations("Score 0, oh zero", [
    { term: "0", say_as: "oh", match_mode: "word" },
    { term: "", say_as: "SKIPPED", match_mode: "substring" },
    { term: "oh", say_as: "zero", match_mode: "word" },
  ]);
  assert.equal(out, "Score oh, zero zero");
});

test("accented names match as whole words", () => {
  const rules = [{ term: "Dončić", say_as: "DON-chitch", match_mode: "word" }];
  assert.equal(applyPronunciations("Luka Dončić scored. Dončić's assist.", rules), "Luka DON-chitch scored. DON-chitch's assist.");
});

test("plurals ride along and phrases beat single words", () => {
  const rules = [
    { term: "fucking", say_as: "freaking", match_mode: "word" },
    { term: "rebound", say_as: "REE-bound", match_mode: "word" },
    { term: "Deep Fucking Value", say_as: "Deep F-ing Value", match_mode: "word" },
  ];
  assert.equal(
    applyPronunciations("12 rebounds and one rebound. Deep fucking value says hi. Fucking great.", rules),
    "12 REE-bounds and one REE-bound. Deep F-ing Value says hi. freaking great.",
  );
});

test("parseTrickyWords accepts = => -> and skips half lines", () => {
  const { parseTrickyWords, formatTrickyWords } = exportsObj;
  const list = parseTrickyWords("rebound = REE-bound\nRBI => R B I\nai -> A I (inside words)\njust a word\n = nothing\nrebound = again");
  assert.deepEqual(list, [
    { term: "rebound", say_as: "REE-bound", match: "word" },
    { term: "RBI", say_as: "R B I", match: "word" },
    { term: "ai", say_as: "A I", match: "substring" },
  ]);
  assert.equal(formatTrickyWords(list), "rebound = REE-bound\nRBI = R B I\nai = A I (inside words)");
});

test("isNeverSay spots swear words only", () => {
  const { isNeverSay } = exportsObj;
  assert.equal(isNeverSay("Deep Fucking Value"), true);
  assert.equal(isNeverSay("rebound"), false);
  assert.equal(isNeverSay("Scunthorpe"), false);
});

test("hundreds of swaps in one script all come back", () => {
  const script = Array.from({ length: 700 }, (_, i) => `rebound ${i}`).join(" ");
  const out = applyPronunciations(script, [{ term: "rebound", say_as: "REE-bound", match_mode: "word" }]);
  assert.equal(out, Array.from({ length: 700 }, (_, i) => `REE-bound ${i}`).join(" "));
});
