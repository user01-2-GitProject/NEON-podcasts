const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync("lib/generate-episode-audio.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("audio runs one bounded TTS chunk per request, heartbeats, and publishes when complete", async () => {
  const calls = [];
  const chunks = [];
  const script = "Hello. ".repeat(500);
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/select e\.script/.test(text)) return [{ script, voice_id: "voice-1" }];
    if (/select chunk_index/.test(text)) return chunks;
    if (/insert into episode_audio_chunks/.test(text)) {
      chunks.push({ chunk_index: values[2], content_type: values[3], provider: values[4], data: values[5] });
    }
    if (/select data, content_type/.test(text)) return chunks;
    if (/with completed as/.test(text)) return [{ id: "episode-1" }];
    return [];
  };
  const stored = [];
  let ttsCalls = 0;
  const modules = {
    "@/lib/db": { sql },
    "@/lib/tts": { chunkText: (text, size) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size)), synthesize: async (_text, voice) => { assert.equal(voice, "voice-1"); ttsCalls++; return { audio: Buffer.from(`mp3-${ttsCalls}`), contentType: "audio/mpeg", provider: "openai" }; } },
    "@/lib/storage": { getStorage: () => ({ put: async (...args) => stored.push(args), url: () => "/api/episodes/episode-1/audio", delete: async () => {} }) },
    "@/lib/mp3": { joinMp3: (parts) => Buffer.concat(parts) },
  };
  const exports = {};
  new Function("require", "exports", source)((name) => modules[name], exports);
  const first = await exports.generateEpisodeAudio("episode-1", "run-1");
  assert.equal(first.complete, false);
  assert.equal(stored.length, 0);
  const second = await exports.generateEpisodeAudio("episode-1", "run-1");
  assert.equal(second.complete, true);
  assert.equal(ttsCalls, 2);
  assert.ok(calls.some((call) => /heartbeat_at = now\(\)/.test(call.text)));
  const finalize = calls.find((call) => /with completed as/.test(call.text));
  assert.ok(finalize);
  assert.match(finalize.text, /status = 'published'/);
  assert.equal(stored.length, 1);
});
