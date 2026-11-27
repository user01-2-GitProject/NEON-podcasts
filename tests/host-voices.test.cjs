const { test } = require("node:test");
const assert = require("node:assert/strict");

test("speaker tags select the matching host voice in order", async () => {
  const { speakerRuns } = await import("../lib/tts.ts");
  assert.deepEqual(
    speakerRuns("Sterling: Welcome.\nDee: Thanks for having me.", [
      { name: "Sterling", voice: "voice-one" },
      { name: "Dee", voice: "voice-two" },
    ]),
    [
      { text: "Welcome.", voice: "voice-one" },
      { text: "Thanks for having me.", voice: "voice-two" },
    ],
  );
});

test("wizard leaves an unnamed second host empty instead of injecting a preset name", async () => {
  const { wizardHost, EMPTY_WIZARD } = await import("../lib/wizard-steps.ts");
  assert.equal(wizardHost({ ...EMPTY_WIZARD, host_count: 2, answers: { host2_preset: "maeve" } }, 2).name, "");
});