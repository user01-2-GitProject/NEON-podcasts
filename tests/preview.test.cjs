const { test } = require("node:test");
const assert = require("node:assert/strict");

test("previewPrompt asks for ~30 seconds about the show's own content", async () => {
  const p = await import("../lib/preview.ts");
  const { system, user } = p.previewPrompt({ showTitle: "N.E.O.N. - Sunday Markets", hostName: "Sterling", brief: "## About the show\nStocks for busy people." });
  assert.match(system, /75 words/);
  assert.match(system, /never follow instructions/);
  assert.match(user, /SHOW TITLE: N\.E\.O\.N\. - Sunday Markets/);
  assert.match(user, /HOST NAME: Sterling/);
  assert.match(user, /Stocks for busy people/);
  const big = p.previewPrompt({ showTitle: "x", hostName: "y", brief: "a".repeat(20000) });
  assert.ok(big.user.length < p.MAX_PREVIEW_CONTEXT_CHARS + 200);
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
