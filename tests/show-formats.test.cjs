const { test } = require("node:test");
const assert = require("node:assert/strict");

test("SHOW_FORMATS: every formatter has a recipe and a sensible default host", async () => {
  const { SHOW_FORMATS, isShowFormat } = await import("../lib/show-formats.ts");
  assert.ok(SHOW_FORMATS.length >= 6, "at least the planned formats");
  for (const f of SHOW_FORMATS) {
    assert.ok(f.id && f.label && f.description, `format ${f.id} missing fields`);
    assert.ok(isShowFormat(f.id));
  }
  assert.equal(isShowFormat("news"), true);
  assert.equal(isShowFormat("not-a-real-format"), false);
  // Ids are unique.
  const ids = SHOW_FORMATS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});
