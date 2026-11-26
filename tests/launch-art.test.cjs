const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const zlib = require("node:zlib");

const artPath = (name) => join(__dirname, "..", "mobile", "assets", name);
const DARK = [11, 13, 18]; // #0b0d12

// Read just enough of a PNG to check its size and top-left background pixel.
// No image library needed: zlib is built into Node.
function pngInfo(name) {
  const buf = readFileSync(artPath(name));
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${name} is not a PNG`);
  let off = 8;
  let idat = [];
  let width, height, depth, colorType;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
      depth = buf[off + 16];
      colorType = buf[off + 17];
    }
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const scale = depth === 16 ? 257 : 1;
  const pixel = [];
  for (let c = 0; c < channels; c++) {
    const at = 1 + c * (depth / 8);
    pixel.push(depth === 16 ? raw.readUInt16BE(at) / scale : raw[at]);
  }
  return { width, height, depth, colorType, pixel };
}

test("icon and adaptive artwork are 1024px circle-N on #0b0d12", () => {
  for (const name of ["icon.png", "adaptive-icon.png"]) {
    const info = pngInfo(name);
    assert.equal(info.width, 1024, name);
    assert.equal(info.height, 1024, name);
    assert.deepEqual(info.pixel.slice(0, 3), DARK, `${name} background`);
  }
});

test("splash artwork is 1242x2436 on #0b0d12", () => {
  const info = pngInfo("splash.png");
  assert.equal(info.width, 1242);
  assert.equal(info.height, 2436);
  assert.deepEqual(info.pixel.slice(0, 3), DARK, "splash background");
});

test("Expo config uses the dark splash/adaptive backgrounds", () => {
  const config = JSON.parse(readFileSync(join(__dirname, "..", "mobile", "app.json"), "utf8"));
  assert.equal(config.expo.android.adaptiveIcon.backgroundColor, "#0b0d12");
  const splash = config.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-splash-screen");
  assert.ok(splash, "expo-splash-screen plugin is configured");
  assert.equal(splash[1].backgroundColor, "#0b0d12");
  assert.equal(splash[1].image, "./assets/splash.png");
  assert.doesNotMatch(JSON.stringify(config), /#F9F0DF/i);
});
