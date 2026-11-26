const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

// Store limits for docs/launch-metadata.md. Each **Label** (N) is followed by a ```text block.
test("every store string in launch-metadata.md fits its character limit", () => {
  const md = readFileSync("docs/launch-metadata.md", "utf8");
  const re = /^\*\*([^*\n]+)\*\* \((\d+)[^)\n]*\)\n+```text\n([\s\S]*?)\n```/gm;
  let checked = 0;
  for (const m of md.matchAll(re)) {
    const [, label, limit, body] = m;
    const length = [...body].length;
    assert.ok(length <= Number(limit), `${label}: ${length} chars, limit ${limit}`);
    assert.ok(length > 0, `${label} is empty`);
    checked++;
  }
  assert.ok(checked >= 7, `expected at least 7 limited fields, found ${checked}`);
});
