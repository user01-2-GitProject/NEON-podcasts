const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = readFileSync("lib/audio-splice.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Only the pure helpers are exercised here: no network, no ffmpeg, no files.
const exportsObj = {};
new Function("require", "exports", compiled)((name) => {
  if (name.startsWith("node:")) return require(name);
  if (name === "@/lib/tts") {
    return {
      estimateDurationSeconds: (script) => {
        const words = script.trim().split(/\s+/).filter(Boolean).length;
        return Math.max(1, Math.round((words / 150) * 60));
      },
    };
  }
  throw new Error(`unexpected import: ${name}`);
}, exportsObj);
const {
  splitIntoSentences,
  wordCount,
  estimateSentenceTimes,
  estimateSentenceStart,
  rebuildScript,
  tailScript,
} = exportsObj;

const script = "It was 30 degrees Celsius. That felt warm! Was it? Yes.\n\nOne more sentence.";

test("sentences keep character offsets into the original script", () => {
  const sentences = splitIntoSentences(script);
  assert.deepEqual(sentences.map((s) => s.text), [
    "It was 30 degrees Celsius.",
    "That felt warm!",
    "Was it?",
    "Yes.",
    "One more sentence.",
  ]);
  for (const s of sentences) {
    assert.equal(script.slice(s.start, s.end), s.text);
    assert.equal(s.index, sentences.indexOf(s));
  }
});

test("decimals and initials stay inside one sentence", () => {
  const text = "It rose 3.5 percent in the U.S. That was quick.";
  assert.deepEqual(splitIntoSentences(text).map((s) => s.text), [
    "It rose 3.5 percent in the U.S.",
    "That was quick.",
  ]);
});

test("an abbreviation does not end a sentence", () => {
  const text = "Dr. Smith said hello. It works.";
  assert.deepEqual(splitIntoSentences(text).map((s) => s.text), ["Dr. Smith said hello.", "It works."]);
});

test("word-count timing divides measured audio between sentences", () => {
  const sentences = splitIntoSentences("one two. three four five six. seven eight nine ten.");
  assert.deepEqual(sentences.map((s) => wordCount(s.text)), [2, 4, 4]);
  const times = estimateSentenceTimes(sentences, 60);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} should be ${b}`);
  close(times[0].start, 0);
  close(times[0].end, (60 * 2) / 10);
  close(times[1].start, (60 * 2) / 10);
  close(times[2].end, 60);
  close(estimateSentenceStart(sentences, 2, 60), (60 * 6) / 10);
});

test("without a measured length the estimate falls back to words/150", () => {
  const sentences = splitIntoSentences("one two. three four five six. seven eight nine ten.");
  const times = estimateSentenceTimes(sentences);
  assert.ok(Math.abs(times[times.length - 1].end - 4) < 1e-9);
  assert.ok(Math.abs(times[1].start - (4 * 2) / 10) < 1e-9);
});

test("only the chosen sentence is written back, and the re-read tail starts there", () => {
  const sentences = splitIntoSentences("Alpha one. Beta two! Gamma three?");
  assert.equal(rebuildScript("Alpha one. Beta two! Gamma three?", sentences, 1, "Beta two, fixed!"), "Alpha one. Beta two, fixed! Gamma three?");
  assert.equal(tailScript(sentences, 1, "Beta two, fixed!"), "Beta two, fixed! Gamma three?");
  assert.equal(tailScript(sentences, 2, "Gamma three, fixed?"), "Gamma three, fixed?");
});

test("ffmpeg and ffprobe are shelled out to, with an explicit crossfade", () => {
  assert.match(source, /exec\(\s*"ffprobe"/);
  assert.match(source, /exec\("ffmpeg"/);
  assert.match(source, /acrossfade=d=/);
  assert.match(source, /DEFAULT_CROSSFADE_SECONDS = 0\.08/);
  assert.match(source, /boundarySeconds <= fade/);
});
