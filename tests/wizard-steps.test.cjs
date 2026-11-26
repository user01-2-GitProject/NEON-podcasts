const { test } = require("node:test");
const assert = require("node:assert/strict");

test("visibleSteps: format branches hide questions for other formats", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const base = { ...w.EMPTY_WIZARD };
  const allIds = w.WIZARD_STEPS.map((s) => s.id);

  const newsIds = w.visibleSteps({ ...base, format: "news" }).map((s) => s.id);
  assert.ok(newsIds.includes("news_count"));
  assert.ok(!newsIds.includes("markets_which"));
  assert.ok(!newsIds.includes("crime_which"));

  const crimeIds = w.visibleSteps({ ...base, format: "truecrime" }).map((s) => s.id);
  assert.ok(crimeIds.includes("crime_which"));
  assert.ok(crimeIds.includes("graphic"));
  assert.ok(!crimeIds.includes("news_count"));

  // Base (no format picked) hides every format branch.
  const baseIds = w.visibleSteps(base).map((s) => s.id);
  for (const id of ["news_count","markets_which","history_era","crime_which","fiction_genre","talk_bits"]) {
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
      cite_sources: "Sometimes",
      news_count: "5",
      important: "Never take a side.",
      rules: "Never share listener names.",
    },
  };
  const body = w.composeWizardBody(draft);
  assert.ok(body.includes("## Format\nNews"), "format in body");
  assert.ok(body.includes("## About the show\nA daily rundown."));
  assert.ok(body.includes("## News\n"));
  assert.ok(body.includes("5/10"));
  assert.ok(body.includes("## What matters most\nNever take a side."));
  assert.ok(body.includes("## Hard rules\nNever share listener names."));
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

test("grayedChoices: conflicts gray the fighting choices; maxPicks grays the rest once reached", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const takeaway = w.WIZARD_STEPS.find((s) => s.id === "takeaway");
  // With "Laugh" picked, "Stay informed" and "A good story" gray out
  // (per the conflicts), the others stay pickable until maxPicks hits.
  let gray = w.grayedChoices(takeaway, ["Laugh"]);
  assert.ok(gray.includes("Stay informed"));
  assert.ok(gray.includes("A good story"));
  assert.ok(!gray.includes("Relax"));
  // Picking a second choice reaches maxPicks (2); everything unpicked grays.
  gray = w.grayedChoices(takeaway, ["Laugh", "Relax"]);
  assert.ok(gray.includes("Get fired up"));
  assert.ok(gray.includes("Learn something"));
});

test("readMulti/writeMulti round-trip picks", async () => {
  const w = await import("../lib/wizard-steps.ts");
  assert.deepEqual(w.readMulti(w.writeMulti(["Politics", "Tech"])), ["Politics", "Tech"]);
  assert.deepEqual(w.readMulti(""), []);
  assert.deepEqual(w.readMulti(undefined), []);
});

test("composeWizardBody includes the format header even with no content answers", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const body = w.composeWizardBody({ title: "T", host_count: 1, format: "history", answers: {} });
  assert.match(body, /^## Format\nHistory\b/);
});

test("brandedTitle: adds the N.E.O. prefix idempotently", async () => {
  const w = await import("../lib/wizard-steps.ts");
  assert.equal(w.brandedTitle("Sunday Morning Markets"), "N.E.O. - Sunday Morning Markets");
  assert.equal(w.brandedTitle("  Sunday Morning Markets  "), "N.E.O. - Sunday Morning Markets");
  // Already prefixed titles are left alone, case- and spacing-insensitive.
  assert.equal(w.brandedTitle("N.E.O. - Sunday Morning Markets"), "N.E.O. - Sunday Morning Markets");
  assert.equal(w.brandedTitle("neo - rebel news"), "neo - rebel news");
  assert.equal(w.brandedTitle("NEO Daily"), "NEO Daily");
});

test("stepsByTab: 1 host hides host2; 2 hosts shows all three tabs", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const one = w.stepsByTab({ ...w.EMPTY_WIZARD, host_count: 1, format: "news" });
  assert.deepEqual(one.map((t) => t.tab.id), ["show", "host1"]);
  const two = w.stepsByTab({ ...w.EMPTY_WIZARD, host_count: 2, format: "news" });
  assert.deepEqual(two.map((t) => t.tab.id), ["show", "host1", "host2"]);
  // host2 tab holds the two-host specifics plus anything_host2.
  const host2 = two.find((t) => t.tab.id === "host2");
  const ids = (host2?.steps || []).map((s) => s.id);
  assert.ok(ids.includes("hosts_dynamic"));
  assert.ok(ids.includes("hosts_disagree"));
  assert.ok(ids.includes("hosts_segments"));
  assert.ok(ids.includes("anything_host2"));
});

test("reviewLines: shows filled answers only, with short previews", async () => {
  const w = await import("../lib/wizard-steps.ts");
  const draft = {
    title: "Weekly Tech",
    host_count: 1,
    format: "news",
    answers: {
      about: "A weekly rundown of the biggest tech moves. Short and sharp.",
      serious: "4",
      cite_sources: "Sometimes",
    },
  };
  const lines = w.reviewLines(draft);
  const byId = Object.fromEntries(lines.map(({ step, line }) => [step.id, line]));
  // title and about are filled; empty answers are skipped.
  assert.equal(byId.title, "Weekly Tech");
  assert.ok(byId.about.startsWith("A weekly rundown"));
  // Scale renders as "N out of M".
  assert.match(byId.serious, /4 out of 5/);
  // Empty ids never appear.
  assert.ok(!("audience" in byId));
});
