const { test } = require("node:test");
const assert = require("node:assert/strict");

const sentence = (i) => `This is sentence number ${i} about the day's news and what it means for you.`;
const scriptOf = (n) => Array.from({ length: n }, (_, i) => sentence(i)).join(" ");

test("a clean script of the right length passes", async () => {
  const { checkScript } = await import("../lib/script-check.ts");
  // ~16 words a sentence; 10 minutes is ~1500 words.
  assert.deepEqual(checkScript(scriptOf(95), 10), []);
});

test("repeats, blanks, markup and cut-off endings are caught in plain words", async () => {
  const { checkScript, needsRewrite } = await import("../lib/script-check.ts");
  const kinds = (s, m = 1) => checkScript(s, m).map((i) => i.kind);
  const loop = scriptOf(5) + " " + sentence(2);
  assert.deepEqual(kinds(loop), ["repeat"]);
  assert.ok(kinds(scriptOf(5) + " Our guest today is [INSERT NAME].").includes("placeholder"));
  assert.ok(kinds("## Intro\n" + scriptOf(5)).includes("markup"));
  assert.ok(kinds(scriptOf(5) + " [MUSIC SWELLS] Back to it.").includes("markup"));
  assert.ok(kinds("HOST: " + scriptOf(5)).includes("markup"));
  assert.ok(kinds(scriptOf(5) + " And then the Fed said that it would").includes("cut-off"));
  const short = checkScript(scriptOf(2), 10);
  assert.deepEqual(short.map((i) => i.kind), ["too-short"]);
  assert.equal(needsRewrite(short), false, "length alone isn't worth a rewrite");
  assert.equal(needsRewrite(checkScript(loop, 1)), true);
  assert.match(checkScript(loop, 1)[0].message, /repeats itself/);
});

test("the rewrite request lists every problem", async () => {
  const { checkScript, rewriteNotes } = await import("../lib/script-check.ts");
  const notes = rewriteNotes(checkScript("## Intro\n" + scriptOf(3) + " " + sentence(1) + " and then", 1));
  assert.match(notes, /failed these checks/);
  assert.match(notes, /repeats itself/);
  assert.match(notes, /headings/);
  assert.match(notes, /mid-sentence/);
});

// A Layer III frame: MPEG1, 128 kbps, 44.1 kHz, no padding = 417 bytes.
function frame(fill = 0x11, tag = "") {
  const f = new Uint8Array(417).fill(fill);
  f.set([0xff, 0xfb, 0x90, 0x64]);
  if (tag) f.set(Buffer.from(tag), 36);
  return f;
}
const cat = (...parts) => Uint8Array.from(Buffer.concat(parts.map((p) => Buffer.from(p))));

test("mp3 frame lengths are read from the header", async () => {
  const { frameLength } = await import("../lib/mp3.ts");
  assert.equal(frameLength(frame(), 0), 417);
  assert.equal(frameLength(new Uint8Array([0, 1, 2, 3]), 0), 0);
});

test("joining voice pieces drops each piece's tags and length header", async () => {
  const { joinMp3, stripMp3Metadata } = await import("../lib/mp3.ts");
  const id3 = cat([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5], [1, 2, 3, 4, 5]);
  const v1tag = cat(Buffer.from("TAG"), new Uint8Array(125));
  const piece = (fill) => cat(id3, frame(0x22, "Xing"), frame(fill), frame(fill), v1tag);
  const a = piece(0xaa);
  const b = piece(0xbb);
  assert.equal(stripMp3Metadata(a).length, 417 * 2);
  const joined = joinMp3([a, b]);
  assert.equal(joined.length, 417 * 4, "only audio frames remain");
  assert.equal(joined[0], 0xff);
  assert.ok(!joined.includes(Buffer.from("Xing")));
  assert.ok(!joined.includes(Buffer.from("TAG")));
  // A piece that's already plain audio is left alone.
  const plain = cat(frame(0x33), frame(0x33));
  assert.equal(stripMp3Metadata(plain).length, plain.length);
  // Something that isn't an mp3 at all is passed through, not cut.
  const junk = new Uint8Array(50).fill(7);
  assert.equal(stripMp3Metadata(junk).length, 50);
});

test("long run-on sentences are split so no voice request is too big", async () => {
  const { chunkText } = await import("../lib/tts.ts");
  const runOn = Array.from({ length: 1200 }, () => "word").join(" ");
  const chunks = chunkText(runOn, 3500);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 3500));
  assert.equal(chunks.join(" "), runOn);
});
