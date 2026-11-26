const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

// E1: every color in the web app comes from the two brand themes.
const css = readFileSync("app/globals.css", "utf8");
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

function block(selector) {
  const i = css.indexOf(selector + " {");
  assert.ok(i >= 0, `missing ${selector} block`);
  const end = css.indexOf("\n}", i);
  return css.slice(i, end);
}
const tokens = (b) => new Set([...b.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));

test("light and dark themes define the same tokens", () => {
  const light = tokens(block(':root[data-theme="light"]'));
  const dark = tokens(block(':root[data-theme="dark"]'));
  assert.ok(light.size >= 15, `only ${light.size} tokens`);
  assert.deepEqual([...light].sort(), [...dark].sort());
});

test("no literal colors outside the theme blocks", () => {
  const rest = css.replace(block(':root[data-theme="light"]'), "").replace(block(':root[data-theme="dark"]'), "");
  assert.ok(!COLOR.test(block(":root")), "the shared :root block holds no colors");
  const strays = rest.split("\n").filter((l) => !l.trim().startsWith("/*") && COLOR.test(l));
  assert.deepEqual(strays, []);
});

test("brand palette, old teal and lavender gone", () => {
  assert.match(block(':root[data-theme="light"]'), /--bg: #F9F2E2;/);
  assert.match(block(':root[data-theme="dark"]'), /--bg: #183341;/);
  for (const old of ["#5eead4", "#c8a2ff", "#0b0d12", "#4dd0e1", "#7c9cff"]) {
    assert.ok(!css.toLowerCase().includes(old), `old color ${old} still in globals.css`);
  }
});

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|css)$/.test(n) ? [p] : [];
  });
}

test("every var(--x) used in the web app is a defined token", () => {
  // Theme tokens plus the theme-independent ones in the plain :root block.
  const defined = new Set([...tokens(block(':root[data-theme="light"]')), ...tokens(block(":root"))]);
  for (const f of [...files("app"), ...files("components")]) {
    if (f.startsWith(join("app", "art"))) continue; // generated cover images, not UI
    for (const m of readFileSync(f, "utf8").matchAll(/var\((--[a-z0-9-]+)/g)) {
      assert.ok(defined.has(m[1]), `${f} uses undefined ${m[1]}`);
    }
  }
});

test("UI components carry no hard-coded colors", () => {
  for (const f of [...files("app"), ...files("components")]) {
    if (!f.endsWith(".tsx") || f.startsWith(join("app", "art")) || f === join("app", "layout.tsx")) continue;
    const hits = (readFileSync(f, "utf8").match(COLOR) || []).filter((h) => !/^#[0-9]+$/.test(h));
    assert.deepEqual(hits, [], f);
  }
});

test("resolveTheme: stored choice wins, else the system preference", async () => {
  const { resolveTheme } = await import("../lib/theme.ts");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme(null, true), "light");
  assert.equal(resolveTheme("bogus", false), "dark");
});
