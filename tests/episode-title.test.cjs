const { test } = require("node:test");
const assert = require("node:assert/strict");

const opts = { showTitle: "N.E.O.N. - Sunday Markets", dateLabel: "Nov 26" };

test("cleanEpisodeTitle strips show name, brand, episode numbers, quotes and markdown", async () => {
  const { cleanEpisodeTitle } = await import("../lib/episode-title.ts");
  assert.equal(cleanEpisodeTitle('"Oil Slides as the Fed Holds."', opts), "Oil Slides as the Fed Holds");
  assert.equal(cleanEpisodeTitle("N.E.O.N. - Sunday Markets: Oil slides", opts), "Oil slides");
  assert.equal(cleanEpisodeTitle("Sunday Markets - Episode 12: Oil slides", opts), "Oil slides");
  assert.equal(cleanEpisodeTitle("Ep. 4 - gold hits a record", opts), "Gold hits a record");
  assert.equal(cleanEpisodeTitle("# **Bonds wobble**", opts), "Bonds wobble");
  assert.equal(cleanEpisodeTitle("Title: Crypto cools off", opts), "Crypto cools off");
});

test("cleanEpisodeTitle never returns Untitled; falls back to show + date", async () => {
  const { cleanEpisodeTitle } = await import("../lib/episode-title.ts");
  assert.equal(cleanEpisodeTitle("Untitled episode", opts), "Sunday Markets for Nov 26");
  assert.equal(cleanEpisodeTitle("", opts), "Sunday Markets for Nov 26");
  assert.equal(cleanEpisodeTitle(null, opts), "Sunday Markets for Nov 26");
  assert.equal(cleanEpisodeTitle("Sunday Markets", opts), "Sunday Markets for Nov 26");
});

test("cleanEpisodeTitle caps long titles on a word", async () => {
  const { cleanEpisodeTitle, MAX_TITLE_CHARS } = await import("../lib/episode-title.ts");
  const long = "The day the market forgot how to count and everyone pretended it was fine for a really long time indeed";
  const out = cleanEpisodeTitle(long, opts);
  assert.ok(out.length <= MAX_TITLE_CHARS + 1, out);
  assert.ok(out.endsWith("…"));
  assert.ok(!/\s…$/.test(out));
});

test("shortDateLabel uses the show's time zone and survives a bad one", async () => {
  const { shortDateLabel } = await import("../lib/episode-title.ts");
  const d = new Date("2026-11-27T03:00:00Z");
  assert.equal(shortDateLabel(d, "America/Detroit"), "Nov 26");
  assert.equal(shortDateLabel(d, "Not/AZone"), "Nov 27");
});

test("generation tidies the writer's title but keeps a planned title", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/generate.ts"), "utf8");
  assert.match(src, /if \(selection\.plan\?\.title\) result\.title = selection\.plan\.title;\s*else result\.title = cleanEpisodeTitle\(/);
});
