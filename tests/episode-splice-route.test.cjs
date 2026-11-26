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

const estimateDurationSeconds = (script) => {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
};
const helpers = load("lib/audio-splice.ts", { "@/lib/tts": { estimateDurationSeconds } });

const EPISODE = {
  id: "ep-1",
  show_id: "show-1",
  script: "It was 30 degrees Celsius. It felt warm. Thanks for listening.",
  audio_url: "/api/episodes/ep-1/audio",
  voice_id: "voice-7",
};

function harness({ episode = EPISODE, failVoice = false, failSplice = false } = {}) {
  const calls = { sql: [], tts: [], put: [], splice: [] };
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.sql.push({ text, values });
    if (/from episodes e join shows s/.test(text)) return episode ? [episode] : [];
    if (/from show_pronunciations/.test(text)) return [];
    if (/update episodes set/.test(text)) return [{ id: "ep-1", script: values[0] }];
    throw new Error(`unexpected query: ${text}`);
  };
  const storage = {
    get: async () => ({ bytes: Buffer.from("original-audio"), contentType: "audio/mpeg" }),
    put: async (key, bytes, type) => calls.put.push({ key, bytes, type }),
    url: (key) => `/api/episodes/${key}/audio`,
  };
  const modules = {
    "next/server": {
      NextResponse: {
        json: (data, init) => Response.json(data, init),
        redirect: (url, status) => new Response(null, { status, headers: { location: String(url) } }),
      },
    },
    "@/lib/db": { sql },
    "@/lib/audio-splice": {
      ...helpers,
      probeMp3Duration: async () => 60,
      spliceAudio: async (args) => {
        calls.splice.push(args);
        if (failSplice) throw new Error("ffmpeg missing");
        return Buffer.from("spliced-audio");
      },
    },
    "@/lib/errors": { sanitizeError: (err) => `safe: ${err.message}` },
    "@/lib/generate": { friendlyVoiceError: (err) => `voice: ${err.message}` },
    "@/lib/pronounce": { applyPronunciations: (s) => s },
    "@/lib/storage": { getStorage: () => storage },
    "@/lib/tts": {
      estimateDurationSeconds,
      synthesize: async (text, voice) => {
        calls.tts.push({ text, voice });
        if (failVoice) throw new Error("no key");
        return { audio: Buffer.from("new-tail"), contentType: "audio/mpeg", provider: "test" };
      },
    },
  };
  return { route: load("app/api/episodes/[id]/splice/route.ts", modules).POST, calls };
}

const ctx = { params: Promise.resolve({ id: "ep-1" }) };
const jsonPost = (body) => new Request("https://app.test/api/episodes/ep-1/splice", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const formPost = (body) => new Request("https://app.test/api/episodes/ep-1/splice", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
});

test("a JSON edit re-reads only the tail, flags the stub, and saves audio + script", async () => {
  const { route, calls } = harness();
  const res = await route(jsonPost({ sentenceIndex: 1, text: "It felt 30 degrees Celsius." }), ctx);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.stubbed, true);
  assert.equal(data.timingSource, "word-count");
  assert.equal(data.crossfadeSeconds, 0.08);
  assert.equal(data.sentenceIndex, 1);
  assert.ok(Math.abs(data.boundarySeconds - 300 / 11) < 1e-9);
  assert.match(data.note, /estimated by word count/);

  assert.deepEqual(calls.tts, [{ text: "It felt 30 degrees Celsius. Thanks for listening.", voice: "voice-7" }]);
  assert.equal(calls.splice.length, 1);
  assert.ok(Math.abs(calls.splice[0].boundarySeconds - 300 / 11) < 1e-9);
  assert.equal(calls.splice[0].crossfadeSeconds, 0.08);
  assert.equal(calls.splice[0].original.toString(), "original-audio");
  assert.equal(calls.splice[0].replacement.toString(), "new-tail");
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].bytes.toString(), "spliced-audio");

  const update = calls.sql.find((c) => /update episodes set/.test(c.text));
  assert.ok(update);
  assert.equal(update.values[0], "It was 30 degrees Celsius. It felt 30 degrees Celsius. Thanks for listening.");
  assert.equal(update.values[2], Buffer.byteLength("spliced-audio"));
});

test("a browser form edit redirects to the editor with the stub flag", async () => {
  const { route, calls } = harness();
  const res = await route(formPost({ sentenceIndex: "1", text: "It felt cool." }), ctx);
  assert.equal(res.status, 303);
  assert.equal(
    res.headers.get("location"),
    "https://app.test/episodes/ep-1/edit?saved=1&fixed=1&stubbed=1",
  );
  assert.equal(calls.tts.length, 1);
  assert.equal(calls.put.length, 1);
});

test("bad edits and unchanged text never call TTS or storage", async () => {
  const bodies = [
    { sentenceIndex: 99, text: "Anything." },
    { sentenceIndex: -1, text: "Anything." },
    { sentenceIndex: 0, text: "" },
    { sentenceIndex: 0, text: "x".repeat(4001) },
    { sentenceIndex: 0, text: EPISODE.script.split(".")[0] + "." },
  ];
  for (const body of bodies) {
    const { route, calls } = harness();
    const res = await route(jsonPost(body), ctx);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(calls.tts.length, 0);
    assert.equal(calls.splice.length, 0);
    assert.equal(calls.put.length, 0);
  }
});

test("unknown episodes and episodes without audio are refused", async () => {
  const missing = harness({ episode: null });
  assert.equal((await missing.route(jsonPost({ sentenceIndex: 0, text: "Hello." }), ctx)).status, 404);
  assert.equal(missing.calls.put.length, 0);

  const noAudio = harness({ episode: { ...EPISODE, audio_url: null } });
  assert.equal((await noAudio.route(jsonPost({ sentenceIndex: 0, text: "Hello." }), ctx)).status, 409);
  assert.equal(noAudio.calls.tts.length, 0);
});

test("voice failure and ffmpeg failure leave the stored audio untouched", async () => {
  for (const options of [{ failVoice: true }, { failSplice: true }]) {
    const { route, calls } = harness(options);
    const res = await route(jsonPost({ sentenceIndex: 1, text: "A corrected sentence." }), ctx);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /voice|spliced/);
    assert.equal(calls.put.length, 0);
    assert.ok(!calls.sql.some((c) => /update episodes set/.test(c.text)));
  }
});
