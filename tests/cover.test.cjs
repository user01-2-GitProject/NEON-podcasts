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
