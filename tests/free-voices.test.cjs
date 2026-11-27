const { test } = require("node:test");
const assert = require("node:assert/strict");

test("catalog has ~25 free Edge voices, unique ids, free ones first", async () => {
  const { EDGE_VOICES, VOICE_CATALOG } = await import("../lib/voices.ts");
  assert.equal(EDGE_VOICES.length, 25);
  const ids = VOICE_CATALOG.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(VOICE_CATALOG[0].free);
  assert.ok(VOICE_CATALOG.filter((v) => v.source === "openai").every((v) => !v.free));
});

test("voice ids route to the right engine", async () => {
  const { voiceSource, voiceName } = await import("../lib/voices.ts");
  assert.equal(voiceSource("edge:en-GB-RyanNeural"), "edge");
  assert.equal(voiceSource("en-GB-RyanNeural"), "edge");
  assert.equal(voiceSource("kokoro:bm_george"), "kokoro");
  assert.equal(voiceSource("onyx"), "openai");
  assert.equal(voiceSource("my-cloned-jimmy"), null);
  assert.equal(voiceSource(""), null);
  assert.equal(voiceName("edge:en-GB-RyanNeural"), "en-GB-RyanNeural");
  assert.equal(voiceName("kokoro:bm_george"), "bm_george");
  assert.equal(voiceName("onyx"), "onyx");
});

test("voice labels are generic, stable, and unique", async () => {
  const { VOICE_CATALOG, voiceLabel } = await import("../lib/voices.ts");
  const labels = VOICE_CATALOG.map((v) => v.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => /^(British|American|Australian|Irish|Canadian|Indian|South African) (male|female) \d+$/.test(label)));
  assert.equal(voiceLabel("edge:en-GB-RyanNeural"), "British male 1");
  assert.equal(voiceLabel("unknown-custom-id"), "Custom voice");
});

test("a free voice stays free whatever the app-wide provider is", async () => {
  const { providerFor } = await import("../lib/tts.ts");
  assert.equal(providerFor("edge:en-GB-RyanNeural", "openai"), "edge");
  assert.equal(providerFor("kokoro:bm_george", "openai"), "local");
  assert.equal(providerFor("onyx", "openai"), "openai");
  assert.equal(providerFor("onyx", "edge"), "edge");
  assert.equal(providerFor(null, "edge"), "edge");
  assert.equal(providerFor("my-cloned-jimmy", "local"), "local");
});

test("every one-tap host uses a real free catalog voice; Sterling is first and British", async () => {
  const { HOST_PRESETS, VOICE_CATALOG } = await import("../lib/voices.ts");
  assert.equal(HOST_PRESETS[0].id, "sterling");
  assert.match(HOST_PRESETS[0].voice, /en-GB/);
  for (const h of HOST_PRESETS) {
    const v = VOICE_CATALOG.find((c) => c.id === h.voice);
    assert.ok(v, `${h.name} voice ${h.voice} is in the catalog`);
    assert.ok(v.free, `${h.name} uses a free voice`);
    assert.match(h.label, /^(British|American|Australian|Irish|Canadian|Indian|South African) (male|female) \d+$/);
    assert.doesNotMatch(h.label, /Sterling|Charles|Ryan|Alloy|Onyx/);
    assert.equal(h.name, "");
  }
});

test("wizard host: one-tap pick, custom name, preview voice, and format fallback", async () => {
  const { wizardHost, composeWizardBody, EMPTY_WIZARD } = await import("../lib/wizard-steps.ts");
  const base = { ...EMPTY_WIZARD, title: "T", format: "news", answers: {} };
  // A preset supplies voice/persona; the name is always user-entered.
  assert.equal(wizardHost(base, 1).name, "");
  // One tap.
  const ellen = { ...base, answers: { host1_preset: "ellen", host1_name: "Avery" } };
  assert.equal(wizardHost(ellen, 1).name, "Avery");
  assert.match(composeWizardBody(ellen), /## Host 1\nThe host is a warm/);
  // Build my own.
  const own = { ...base, answers: { host1_preset: "custom", host1_name: "Maya" } };
  assert.equal(wizardHost(own, 1).name, "Maya");
  assert.doesNotMatch(composeWizardBody(own), /## Host 1\n\n/);
  // The preview screen's voice pick wins.
  const picked = { ...base, answers: { host1_preset: "sterling", host1_voice: "onyx" } };
  assert.deepEqual(wizardHost(picked, 1), { name: "", voice: "onyx" });
  // Second host.
  const two = { ...base, host_count: 2, answers: { host2_preset: "maeve", host2_name: "Sam" } };
  assert.equal(wizardHost(two, 2).name, "Sam");
  assert.equal(wizardHost({ ...base, host_count: 2 }, 2).name, "");
});
