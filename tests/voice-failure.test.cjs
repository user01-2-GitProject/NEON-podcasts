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

const SHOW = { id: "show-1", title: "Diamond Hands", description: "Stocks", style_guide: "", target_minutes: 5, voice_id: null, narration_mode: "auto", timezone: "UTC" };

function fakeDb() {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/select \* from shows/.test(text)) return [SHOW];
    if (/insert into runs/.test(text)) return [{ id: "run-1" }];
    if (/insert into episodes/.test(text)) return [{ id: "ep-1", title: values[1], script: values[2], status: "draft" }];
    return [];
  };
  return { sql, calls };
}

const okScript = async () => ({ result: { title: "Ep 1", script: "Hello listeners.", show_notes: "notes" }, model: "m", inputTokens: 1, outputTokens: 1 });

function generate(db, synthesize, generateScript = okScript) {
  return load("lib/generate.ts", {
    "@/lib/db": { sql: db.sql, getSql: () => ({ transaction: async () => [[]] }) },
    "@/lib/claude": {
      generateScript,
      estimateCostCents: () => 3,
    },
    "@/lib/tts": { synthesize, estimateDurationSeconds: () => 60 },
    "@/lib/pronounce": { applyPronunciations: (s) => s },
    "@/lib/storage": { getStorage: () => { throw new Error("storage should not be touched"); } },
    "@/lib/episode-spec": require("../lib/episode-spec.ts"),
    "@/lib/script-check": require("../lib/script-check.ts"),
    "@/lib/research": { researchBrief: () => null },
  });
}

test("a voice failure on a pressed run keeps the script as a draft", async () => {
  const db = fakeDb();
  const { generateEpisode } = generate(db, async () => {
    throw new Error("No OpenAI voice key: paste one under Settings → Voice, or use Script only narration");
  });
  const out = await generateEpisode("show-1");
  assert.equal(out.episode.id, "ep-1");
  assert.equal(out.episode.script, "Hello listeners.");
  assert.match(out.voiceError, /script is saved/);
  assert.match(out.voiceError, /Settings → Voice/);
  const run = db.calls.find((c) => /update runs set/.test(c.text) && /status = 'failed'/.test(c.text));
  assert.ok(run, "run marked failed");
  assert.ok(run.values.includes("ep-1"), "run points at the saved draft");
  assert.ok(!db.calls.some((c) => /delete from episodes/.test(c.text)), "draft is not deleted");
});

test("a scheduled run still throws so it can retry", async () => {
  const db = fakeDb();
  const { generateEpisode } = generate(db, async () => {
    throw new Error("boom");
  });
  await assert.rejects(generateEpisode("show-1", undefined, { id: "run-9", scheduledFor: "2026-11-25T10:00:00Z" }), /boom/);
  assert.ok(!db.calls.some((c) => /insert into episodes/.test(c.text)));
});

test("friendlyVoiceError never leaks provider details", () => {
  const { friendlyVoiceError } = generate(fakeDb(), async () => ({}));
  const msg = friendlyVoiceError(new Error("401 Incorrect API key provided: sk-abc123"));
  assert.ok(!msg.includes("sk-abc123"));
  assert.match(msg, /Make audio/);
});

test("a script that repeats itself gets one rewrite before audio", async () => {
  const db = fakeDb();
  const looped = "The market closed higher today on strong earnings from the big banks. ".repeat(2) + "Thanks for listening.";
  const calls = [];
  const writer = async (args) => {
    calls.push(args);
    const script = calls.length === 1 ? looped : "A clean script with no problems at all. Thanks for listening.";
    return { result: { title: "Ep", script, show_notes: "n" }, model: "m", inputTokens: 10, outputTokens: 10 };
  };
  const { generateEpisode } = generate(db, async () => { throw new Error("no voice"); }, writer);
  const out = await generateEpisode("show-1");
  assert.equal(calls.length, 2);
  assert.match(calls[1].fixNotes, /repeats itself/);
  assert.equal(out.episode.script, "A clean script with no problems at all. Thanks for listening.");
});

test("a clean script is written once", async () => {
  const db = fakeDb();
  let n = 0;
  const writer = async (args) => { n++; return okScript(args); };
  const { generateEpisode } = generate(db, async () => { throw new Error("no voice"); }, writer);
  await generateEpisode("show-1");
  assert.equal(n, 1);
});
