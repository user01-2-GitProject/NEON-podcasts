const { test } = require("node:test");
const assert = require("node:assert/strict");

test("previewScript makes an approximately 60-second format-specific first paragraph", async () => {
  const p = await import("../lib/preview.ts");
  const opts = { showTitle: "Sunday Markets", hostName: "Sterling", about: "Stocks for busy people." };
  const script = p.previewScript({ ...opts, format: "markets" });
  const words = script.split(/\s+/).length;
  assert.ok(Math.abs(words - p.PREVIEW_WORDS) <= 10, `${words} words`);
  assert.match(script, /Sunday Markets/);
  assert.match(script, /Stocks for busy people/);
  assert.match(script, /what moved, what drove it/);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.doesNotMatch(script, /people\.\./);
  assert.notEqual(p.previewScript({ ...opts, format: "history" }), script);
});

test("cleanPreviewScript strips labels and cues and caps length at a sentence", async () => {
  const p = await import("../lib/preview.ts");
  assert.equal(p.cleanPreviewScript('Host: "Welcome to the show. [music swells] Let\'s go."'), "Welcome to the show. Let's go.");
  assert.equal(p.cleanPreviewScript("**Hello** there (soft music) friends."), "Hello there friends.");
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const out = p.cleanPreviewScript(long);
  assert.ok(out.length <= p.MAX_PREVIEW_CHARS, String(out.length));
  assert.ok(out.endsWith("."));
});

test("previewCounterKey is per user per UTC day", async () => {
  const p = await import("../lib/preview.ts");
  assert.equal(p.previewCounterKey("u1", new Date("2026-11-26T23:59:00Z")), "preview_uses:u1:2026-11-26");
});

test("preview route guards cost: owner-only bypass, daily cap, spend cap, re-voice skips the writer", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/api/preview/route.ts"), "utf8");
  assert.match(src, /if \(!isOwner\)/);
  assert.match(src, /checkGeneration\(/);
  assert.match(src, /PREVIEWS_PER_DAY/);
  assert.match(src, /let script = given;\s*if \(!script\)/);
  assert.match(src, /previewScript\(/);
  assert.doesNotMatch(src, /completeText/);
  assert.match(src, /synthesize\(script\.slice\(0, MAX_PREVIEW_CHARS\)/);
});

test("voiceSampleLine is a short fixed line in the voice's own name that survives cleanup", async () => {
  const p = await import("../lib/preview.ts");
  const line = p.voiceSampleLine("Ryan - British man, newsreader");
  assert.equal(line, "Hi, I'm Ryan. This is how I'd sound reading your show on NEON.");
  assert.equal(p.cleanPreviewScript(line), line);
  assert.ok(line.split(/\s+/).length <= 15, "about five seconds");
  assert.equal(p.voiceSampleLine(""), "Hi. This is how I'd sound reading your show on NEON.");
});
