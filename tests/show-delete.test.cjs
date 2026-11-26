const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

function load(path, modules) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in modules) return modules[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`unexpected import ${name}`);
  }, exports);
  return exports;
}

function showRoute(sql, storage) {
  return load("app/api/shows/[id]/route.ts", {
    "next/server": require("next/server"),
    "@/lib/db": { sql },
    "@/lib/cadence": require("../lib/cadence.ts"),
    "@/lib/schedule": { scheduleError: () => null },
    "@/lib/show-image": { parseImageUrl: () => null },
    "@/lib/storage": { getStorage: () => storage },
  });
}

const params = (id) => ({ params: Promise.resolve({ id }) });

test("DELETE removes the show row before its audio, so the scheduler can't pick it up mid-cleanup", async () => {
  const order = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    order.push(text.includes("delete from shows") ? "delete-show" : "sql");
    if (text.includes("delete from shows")) return [{ deleted: 1, episode_ids: ["ep-1", "ep-2"] }];
    return [];
  };
  const storage = { delete: async (key) => order.push(`audio:${key}`) };
  const { DELETE } = showRoute(sql, storage);
  const res = await DELETE(new Request("https://app.test/api/shows/show-1", { method: "DELETE" }), params("show-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(order, ["delete-show", "audio:ep-1", "audio:ep-2"]);
});

test("DELETE of a show that doesn't exist says so in plain words", async () => {
  const sql = async () => [{ deleted: 0, episode_ids: [] }];
  const { DELETE } = showRoute(sql, { delete: async () => assert.fail("no audio to delete") });
  const res = await DELETE(new Request("https://app.test/api/shows/nope", { method: "DELETE" }), params("nope"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "We couldn't find that show.");
});

// generateEpisode: if the show is deleted while audio uploads, don't leave the mp3 behind.
const SHOW = { id: "show-1", title: "T", description: "", style_guide: "", target_minutes: 5, voice_id: null, narration_mode: "auto", timezone: "UTC" };

function generate({ publishRows }) {
  const deleted = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    if (/select \* from shows/.test(text)) return [SHOW];
    if (/insert into runs/.test(text)) return [{ id: "run-1" }];
    if (/insert into episodes/.test(text)) return [{ id: "ep-1", title: values[1], script: values[2], status: "draft" }];
    if (/update episodes set audio_url/.test(text)) return publishRows;
    return [];
  };
  const storage = { url: (k) => `/audio/${k}`, put: async () => {}, delete: async (k) => deleted.push(k) };
  const mod = load("lib/generate.ts", {
    "@/lib/db": { sql, getSql: () => ({ transaction: async () => [[]] }) },
    "@/lib/episode-title": require("../lib/episode-title.ts"),
    "@/lib/claude": {
      generateScript: async () => ({ result: { title: "Ep 1", script: "Hello listeners. ".repeat(200), show_notes: "n" }, model: "m", inputTokens: 1, outputTokens: 1 }),
      estimateCostCents: () => 3,
      mostImportant: () => null,
    },
    "@/lib/tts": { synthesize: async () => ({ audio: Buffer.from("mp3"), contentType: "audio/mpeg", provider: "fake" }), estimateDurationSeconds: () => 60 },
    "@/lib/pronounce": { applyPronunciations: (s) => s, isNeverSay: () => false },
    "@/lib/storage": { getStorage: () => storage },
    "@/lib/episode-spec": require("../lib/episode-spec.ts"),
    "@/lib/script-check": { checkScript: () => [], needsRewrite: () => false, rewriteNotes: () => "" },
    "@/lib/script-qa": { runScriptQa: async () => ({ notes: [], model: null, checked_at: "2026-01-01T00:00:00.000Z" }) },
    "@/lib/research": { researchBrief: () => null },
  });
  return { ...mod, deleted };
}

test("audio uploaded for an episode that vanished (show deleted mid-run) is removed again", async () => {
  const g = generate({ publishRows: [] });
  await assert.rejects(g.generateEpisode("show-1"), /deleted while/);
  assert.deepEqual(g.deleted, ["ep-1"]);
});

test("normal publish keeps the audio", async () => {
  const g = generate({ publishRows: [{ id: "ep-1" }] });
  const out = await g.generateEpisode("show-1");
  assert.equal(out.episode.id, "ep-1");
  assert.deepEqual(g.deleted, []);
});
