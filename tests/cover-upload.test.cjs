const { test } = require("node:test");
const assert = require("node:assert/strict");

function png(w, h) {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function jpeg(w, h, channels = 3) {
  // SOI, an APP0 segment, then SOF0.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(12);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(10, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = channels;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

test("imageInfo reads PNG and JPEG sizes from the header", async () => {
  const { imageInfo } = await import("../lib/cover-upload.ts");
  assert.deepEqual(imageInfo(png(3000, 3000)), { contentType: "image/png", width: 3000, height: 3000 });
  assert.deepEqual(imageInfo(jpeg(1400, 1400)), { contentType: "image/jpeg", width: 1400, height: 1400, cmyk: false });
  assert.equal(imageInfo(Buffer.from("<svg></svg>")), null);
  assert.equal(imageInfo(Buffer.from("GIF89a....")), null);
});

test("checkCover enforces Apple's rules with plain errors", async () => {
  const { checkCover, COVER_MAX_BYTES } = await import("../lib/cover-upload.ts");
  assert.deepEqual(checkCover(png(3000, 3000)), { contentType: "image/png" });
  assert.deepEqual(checkCover(jpeg(1400, 1400)), { contentType: "image/jpeg" });
  assert.match(checkCover(png(1400, 1000)).error, /square/);
  assert.match(checkCover(png(1000, 1000)).error, /1400 and 3000/);
  assert.match(checkCover(png(4000, 4000)).error, /1400 and 3000/);
  assert.match(checkCover(jpeg(2000, 2000, 4)).error, /CMYK/);
  assert.match(checkCover(Buffer.from("hello")).error, /JPG or PNG/);
  assert.match(checkCover(Buffer.alloc(0)).error, /empty/);
  assert.match(checkCover(Buffer.concat([png(3000, 3000), Buffer.alloc(COVER_MAX_BYTES)])).error, /4 MB/);
});

test("artworkPath uses an uploaded cover only for its own show", async () => {
  const { artworkPath } = await import("../lib/cover.ts");
  const { uploadedCoverPath, isUploadedCoverPath } = await import("../lib/cover-upload.ts");
  const id = "3f2a9c1e-0000-4000-8000-000000000001";
  const other = "3f2a9c1e-0000-4000-8000-000000000002";
  const up = uploadedCoverPath(id, 1234567);
  assert.equal(up, `/art/${id}?u=${(1234567).toString(36)}`);
  assert.ok(isUploadedCoverPath(id, up));
  assert.equal(artworkPath({ id, title: "A", image_url: up }), up);
  // Another show's upload path, or a tampered one, falls back to the free cover.
  assert.match(artworkPath({ id: other, title: "A", image_url: up }), /\?v=/);
  assert.match(artworkPath({ id, title: "A", image_url: `/art/${id}?u=x&evil=1` }), /\?v=/);
});

test("showToSpec leaves an uploaded cover out of the editable setup", async () => {
  const { showToSpec } = await import("../lib/show-spec.ts");
  const base = {
    title: "T", description: "", style_guide: "", voice_id: null, narration_mode: "auto",
    cadence: "manual", schedule_time: "06:00", timezone: "America/New_York", target_minutes: 10,
  };
  assert.equal(showToSpec({ ...base, image_url: "/art/abc?u=1" }, []).image_url, "");
  const site = "https://needlesslyengineeredonlinenetwork.com/a.png";
  assert.equal(showToSpec({ ...base, image_url: site }, []).image_url, site);
});
