const { test } = require("node:test");
const assert = require("node:assert/strict");

test("visibleSteps: format branches hide questions for other formats", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const base = { ...w.EMPTY_WIZARD };
  const allIds = w.WIZARD_STEPS.map((s) => s.id);

  const newsIds = w.visibleSteps({ ...base, format: "news" }).map((s) => s.id);
  assert.ok(newsIds.includes("news_which"));
  assert.ok(!newsIds.includes("markets_which"));
  assert.ok(!newsIds.includes("crime_which"));

  const crimeIds = w.visibleSteps({ ...base, format: "truecrime" }).map((s) => s.id);
  assert.ok(crimeIds.includes("crime_which"));
  assert.ok(crimeIds.includes("graphic"));
  assert.ok(!crimeIds.includes("news_which"));

  // Base (no format picked) hides every format branch.
  const baseIds = w.visibleSteps(base).map((s) => s.id);
  for (const id of ["news_which","markets_which","history_era","crime_which","fiction_genre","talk_age"]) {
    assert.ok(!baseIds.includes(id), `expected ${id} hidden with no format`);
  }

  // Second-host questions only appear with host_count 2.
  const two = { ...base, host_count: 2 };
  assert.ok(w.visibleSteps(two).map((s) => s.id).includes("hosts_dynamic"));
  assert.ok(!baseIds.includes("hosts_dynamic"));

  // "title" is required; everything else is optional.
  const req = w.WIZARD_STEPS.filter((s) => s.required).map((s) => s.id);
  assert.deepEqual(req, ["title"]);

  // No duplicate step ids.
  assert.equal(new Set(allIds).size, allIds.length);
});

test("composeWizardBody: groups by section and uses the special headings", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const draft = {
    title: "Test",
    host_count: 1,
    format: "news",
    answers: {
      about: "A daily rundown.",
      audience: "Casual readers",
      tone: "Calm",
      serious: "4",
      cite_sources: "yes",
      news_which: "US national news",
      news_count: "5",
      length: "About 10 minutes",
      important: "Never take a side.",
      rules: "Never share listener names.",
      lookup: "Today's top US stories",
    },
  };
  const body = w.composeWizardBody(draft);
  assert.ok(body.includes("## Format\nNews"), "format in body");
  assert.ok(body.includes("## About the show\nA daily rundown."));
  assert.ok(body.includes("## News\n"));
  assert.ok(body.includes("US national news"));
  assert.ok(body.includes("5/10"));
  assert.ok(body.includes("## What matters most\nNever take a side."));
  assert.ok(body.includes("## Hard rules\nNever share listener names."));
  assert.ok(body.includes("## Look up before each episode\nToday's top US stories"));
});

test("cadence and minutes helpers map wizard answers back to stored values", async () => {
  const w = await import("../lib/wizard-steps.ts");
  assert.equal(w.cadenceFromAnswer("Every day"), "daily");
  assert.equal(w.cadenceFromAnswer("Weekdays only"), "weekdays");
  assert.equal(w.cadenceFromAnswer(undefined), "manual");
  assert.equal(w.cadenceFromAnswer("Nope"), "manual");
  assert.equal(w.minutesFromLengthAnswer("About 20 minutes"), 20);
  assert.equal(w.minutesFromLengthAnswer(undefined), 10);
  assert.equal(w.formatIdFromLabel("News"), "news");
  assert.equal(w.formatIdFromLabel("not a thing"), "");
});

test("composeWizardBody includes the format header even with no content answers", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const body = w.composeWizardBody({ title: "T", host_count: 1, format: "history", answers: {} });
  assert.match(body, /^## Format\nHistory\b/);
});
