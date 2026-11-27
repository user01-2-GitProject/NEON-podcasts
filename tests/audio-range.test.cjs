const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = readFileSync("app/api/episodes/[id]/audio/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function route() {
  const exports = {};
  const sql = () => [{ title: "Range test episode" }];
  const storage = {
    get: async () => ({ bytes: Buffer.from("0123456789"), contentType: "audio/mpeg" }),
  };
  new Function("require", "exports", compiled)((name) => {
    if (name === "@/lib/db") return { sql };
    if (name === "@/lib/storage") return { getStorage: () => storage };
    if (name === "@/lib/errors") return { sanitizeError: String };
    if (name === "next/server") return { NextResponse: { json: Response.json }, after: () => {} };
    if (name === "@/lib/generate-episode-audio") return { generateEpisodeAudio: async () => {} };
    if (name === "@/lib/run-generation") return { runGenerationInBackground: async () => {} };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports.GET;
}

async function get(headers = {}, url = "https://podcasts.example/api/episodes/episode-1/audio") {
  return route()(new Request(url, { headers }), { params: Promise.resolve({ id: "episode-1" }) });
}

test("audio GET returns the full body when no Range header is present", async () => {
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(await response.text(), "0123456789");
});

test("audio GET returns only the requested byte range", async () => {
  const response = await get({ Range: "bytes=0-3" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/10");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), "0123");
});

test("audio GET defaults an open end and clamps an oversized end", async () => {
  const response = await get({ Range: "bytes=7-" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 7-9/10");
  assert.equal(await response.text(), "789");

  const clamped = await get({ Range: "bytes=5-999999999999999999999999" });
  assert.equal(clamped.status, 206);
  assert.equal(clamped.headers.get("content-range"), "bytes 5-9/10");
  assert.equal(await clamped.text(), "56789");
});

test("audio GET rejects malformed and unsatisfiable ranges", async () => {
  for (const range of ["bytes=bad", "bytes=8-2", "bytes=10-"]) {
    const response = await get({ Range: range });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
});

test("audio GET keeps the download disposition on ranged responses", async () => {
  const response = await get(
    { Range: "bytes=0-0" },
    "https://podcasts.example/api/episodes/episode-1/audio?download=1&feed=public-token",
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="range-test-episode.mp3"');
});
