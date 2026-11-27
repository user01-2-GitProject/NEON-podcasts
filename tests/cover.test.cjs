const { test } = require("node:test");
const assert = require("node:assert/strict");

test("artworkPath: NEON-site art wins; anything else gets the generated cover, versioned by title", async () => {
  const { artworkPath } = await import("../lib/cover.ts");
  const id = "3f2a9c1e-0000-4000-8000-000000000001";
  const own = "https://www.needlesslyengineeredonlinenetwork.com/shows/a/cover.png";
  assert.equal(artworkPath({ id, title: "A", image_url: own }), own);
  // An outside link saved before links were turned off never reaches a page or feed.
  assert.match(artworkPath({ id, title: "A", image_url: "https://x.test/a.png" }), /^\/art\//);
  const a = artworkPath({ id, title: "A", image_url: null });
  assert.match(a, new RegExp(`^/art/${id}\\?v=[a-z0-9]+$`));
  assert.notEqual(a, artworkPath({ id, title: "B" }));
  assert.match(artworkPath({ id, title: "A", image_url: "TBD" }), /^\/art\//);
});

test("cover palette is stable per show and the title always fits", async () => {
  const { coverPalette, coverFontSize } = await import("../lib/cover.ts");
  assert.deepEqual(coverPalette("abc"), coverPalette("abc"));
  for (const t of ["Hi", "Diamond Hands", "Supercalifragilisticexpialidocious", "x ".repeat(80)]) {
    const size = coverFontSize(t);
    assert.ok(size >= 64 && size <= 200, `${t}: ${size}`);
  }
});

test("official covers get the 18% NEON mark at 4% inset and become quality-90 JPEG", async () => {
  const sharp = require("sharp");
  const { hasOfficialCoverStamp, stampOfficialCover, COVER_STAMP_SCALE, COVER_STAMP_MARGIN } = await import("../lib/cover.ts");
  assert.equal(COVER_STAMP_SCALE, 0.18);
  assert.equal(COVER_STAMP_MARGIN, 0.04);
  const plain = await sharp({ create: { width: 1400, height: 1400, channels: 3, background: "#183341" } }).jpeg().toBuffer();
  assert.equal(await hasOfficialCoverStamp(plain), false);
  const stamped = await stampOfficialCover(plain);
  const metadata = await sharp(stamped).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1400);
  assert.equal(metadata.height, 1400);
  assert.equal(await hasOfficialCoverStamp(stamped), true);
});
