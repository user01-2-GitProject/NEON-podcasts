const { test } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");

const web = readFileSync("components/OfficialBadge.tsx", "utf8");
const mobile = readFileSync("mobile/components/OfficialBadge.tsx", "utf8");
const globals = readFileSync("app/globals.css", "utf8");

const ASSETS = [
  "neon-logo-orbit-360-clean.gif",
  "neon-logo-orbit-transparent.webm",
  "n-removebg-preview.png",
  "NEONspelledout.png",
  "ALneonicon.jpg",
];

test("all confirmed branding-shelf files ship on web and mobile", () => {
  for (const name of ASSETS) {
    for (const root of ["public/brand", "mobile/assets/brand"]) {
      const path = join(root, name);
      assert.ok(existsSync(path), `${path} is missing`);
      assert.ok(statSync(path).size > 1024, `${path} is empty`);
    }
    assert.equal(
      readFileSync(join("public/brand", name)).toString("hex"),
      readFileSync(join("mobile/assets/brand", name)).toString("hex"),
      `${name} differs between web and mobile`,
    );
  }
  assert.equal(readFileSync("public/brand/neon-logo-orbit-360-clean.gif").subarray(0, 6).toString(), "GIF89a");
  assert.equal(readFileSync("public/brand/neon-logo-orbit-transparent.webm").subarray(0, 4).toString("hex"), "1a45dfa3");
  assert.equal(readFileSync("public/brand/n-removebg-preview.png").subarray(1, 4).toString(), "PNG");
});

test("the web badge uses the canonical orbit files with a reduced-motion still", () => {
  assert.match(web, /src="\/brand\/neon-logo-orbit-transparent\.webm"/);
  assert.match(web, /type="video\/webm"/);
  assert.match(web, /src="\/brand\/neon-logo-orbit-360-clean\.gif"/);
  assert.match(web, /poster="\/brand\/neon-logo-orbit-still\.png"/);
  assert.match(web, /src="\/brand\/neon-logo-orbit-still\.png"/);
  assert.match(web, /class(?:Name)?="official-badge-still"/);
  // No component-level CSS import: the offline TSX compiler doesn't handle CSS.
  assert.doesNotMatch(web, /import "\.\/.*\.css"/);
  assert.match(globals, /prefers-reduced-motion: reduce[\s\S]*official-badge-still[\s\S]*display: block/);
  assert.equal(readFileSync("public/brand/neon-logo-orbit-still.png").subarray(1, 4).toString(), "PNG");
});

test("the native badge uses the bundled branded gif", () => {
  assert.match(mobile, /require\("\.\.\/assets\/brand\/neon-logo-orbit-360-clean\.gif"\)/);
  assert.doesNotMatch(mobile, /assets\/neon-official\.gif/);
});

test("the old unbranded web gif is gone; the native one stays for #109", () => {
  assert.equal(existsSync("public/neon-official.gif"), false);
  assert.equal(existsSync("mobile/assets/neon-official.gif"), true); // E4 draft still requires it
  assert.equal(existsSync("public/neon-official-still.png"), true);
});
