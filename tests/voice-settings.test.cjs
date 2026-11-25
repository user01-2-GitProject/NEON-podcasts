const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

// Transpile a TS module and run it with its imports swapped for test doubles.
function load(path, modules) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

// A fake app_settings table behind the sql tag.
function fakeDb(initial = {}) {
  const rows = { ...initial };
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    if (/^\s*select key, value from app_settings/.test(text)) return Object.entries(rows).map(([key, value]) => ({ key, value }));
    if (/delete from app_settings/.test(text)) { delete rows[values[0]]; return []; }
    if (/insert into app_settings/.test(text)) { rows[values[0]] = values[1]; return []; }
    throw new Error(`unexpected sql: ${text}`);
  };
  return { sql, rows };
}

const settingsWith = (db) => load("lib/settings.ts", { "@/lib/db": { sql: db.sql } });

function voiceRoute(db, owner) {
  return load("app/api/settings/voice/route.ts", {
    "next/server": require("next/server"),
    "@/lib/settings": settingsWith(db),
    "@/lib/token-owner": { ownerId: async () => owner },
  });
}

const post = (body) =>
  new Request("https://app.test/api/settings/voice", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("ttsConfigFrom: saved settings beat env, env beats defaults", () => {
  const { ttsConfigFrom } = settingsWith(fakeDb());
  assert.deepEqual(ttsConfigFrom({}, {}), {
    provider: "openai", openAiApiKey: null, openAiVoice: "alloy", openAiModel: "gpt-4o-mini-tts",
  });
  const env = { TTS_PROVIDER: "local", OPENAI_API_KEY: "sk-env", OPENAI_TTS_VOICE: "nova", OPENAI_TTS_MODEL: "tts-1" };
  assert.deepEqual(ttsConfigFrom({}, env), { provider: "local", openAiApiKey: "sk-env", openAiVoice: "nova", openAiModel: "tts-1" });
  const saved = { tts_provider: "openai", openai_tts_api_key: "sk-saved", openai_tts_voice: "onyx", openai_tts_model: "gpt-4o-mini-tts" };
  assert.deepEqual(ttsConfigFrom(saved, env), { provider: "openai", openAiApiKey: "sk-saved", openAiVoice: "onyx", openAiModel: "gpt-4o-mini-tts" });
  assert.equal(ttsConfigFrom({ tts_provider: "bogus" }, {}).provider, "openai");
});

test("pickOpenAiVoice keeps built-in voices and falls back for cloned names", () => {
  const { pickOpenAiVoice } = settingsWith(fakeDb());
  assert.equal(pickOpenAiVoice("Nova", "alloy"), "nova");
  assert.equal(pickOpenAiVoice("jimmy-clone", "alloy"), "alloy");
  assert.equal(pickOpenAiVoice(null, "onyx"), "onyx");
});

test("voice settings are owner-only", async () => {
  const db = fakeDb({ openai_tts_api_key: "sk-secret-123456" });
  const route = voiceRoute(db, null);
  assert.equal((await route.GET()).status, 403);
  assert.equal((await route.POST(post({ openai_api_key: "sk-evil" }))).status, 403);
  assert.equal(db.rows.openai_tts_api_key, "sk-secret-123456");
});

test("saving a key stores it but never returns it", async () => {
  const db = fakeDb();
  const route = voiceRoute(db, "owner-1");
  const res = await route.POST(post({ provider: "openai", openai_api_key: "  sk-proj-abcdefghijklmnop  ", openai_voice: "nova" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(db.rows.openai_tts_api_key, "sk-proj-abcdefghijklmnop");
  assert.equal(db.rows.openai_tts_voice, "nova");
  assert.equal(db.rows.tts_provider, "openai");
  assert.equal(body.openai_key_set, true);
  assert.equal(body.openai_key_source, "settings");
  assert.equal(body.openai_key_hint, "sk-p…mnop");
  assert.equal(body.openai_voice, "nova");
  assert.ok(!JSON.stringify(body).includes("abcdefghijklmnop"));
});

test("bad input is rejected and nothing is written", async () => {
  const db = fakeDb();
  const route = voiceRoute(db, "owner-1");
  for (const bad of [{ provider: "nope" }, { openai_voice: "darth" }, { openai_api_key: "sk with spaces" }, { openai_api_key: "x".repeat(301) }]) {
    assert.equal((await route.POST(post(bad))).status, 400, JSON.stringify(bad));
  }
  assert.equal((await route.POST(post("not json"))).status, 400);
  assert.deepEqual(db.rows, {});
});

test("clearing the key and picking the default voice remove the rows", async () => {
  const db = fakeDb({ openai_tts_api_key: "sk-secret-123456", openai_tts_voice: "nova" });
  const route = voiceRoute(db, "owner-1");
  const body = await (await route.POST(post({ clear_openai_api_key: true, openai_voice: "alloy" }))).json();
  assert.deepEqual(db.rows, {});
  assert.equal(body.openai_voice, "alloy");
  assert.equal(body.openai_key_hint, null);
});
