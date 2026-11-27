const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync("lib/generate-episode-audio.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("episode audio refreshes the run heartbeat and atomically publishes after TTS", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return calls.length === 1 ? [{ script: "A complete script.", voice_id: "voice-1" }] : [{ id: "episode-1" }];
  };
  const stored = [];
  const modules = {
    "@/lib/db": { sql },
    "@/lib/tts": { synthesize: async (_script, voice, onChunk) => { assert.equal(voice, "voice-1"); await onChunk(); return { audio: Buffer.from("mp3"), contentType: "audio/mpeg", provider: "openai" }; } },
    "@/lib/storage": { getStorage: () => ({ put: async (...args) => stored.push(args), url: () => "/api/episodes/episode-1/audio", delete: async () => {} }) },
  };
  const exports = {};
  new Function("require", "exports", source)((name) => modules[name], exports);
  await exports.generateEpisodeAudio("episode-1", "run-1");
  assert.match(calls[1].text, /heartbeat_at = now\(\)/);
  assert.match(calls[2].text, /with completed as/);
  assert.match(calls[2].text, /status = 'published'/);
  assert.equal(stored.length, 1);
});
