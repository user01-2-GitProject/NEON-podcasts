const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../lib/fact-check.ts");
const personas = require("../lib/fact-check-personas.json");

const note = (kind, message, excerpt) => ({ kind, message, excerpt });
const flag = (persona, kind, message, excerpt) => ({ persona, kind, message, excerpt });
const member = (persona, notes = []) => ({ persona, model: `${persona}-model`, notes });

function submission(overrides = {}) {
  return {
    members: [member("quickdraw"), member("scholar")],
    upheld: [],
    dismissed: [],
    verdict: "pass",
    tags: [],
    added_sources: [],
    ...overrides,
  };
}

// Council results always carry a verdict consistent with the unanimous rule.
async function accepted(overrides = {}) {
  const fc = await load();
  const checked = fc.validateCouncilSubmission(submission(overrides));
  assert.equal(checked.ok, true, checked.error);
  return checked.value;
}

test("noteKey is exported and normalizes excerpts and messages", async () => {
  const { noteKey } = await load();
  assert.equal(
    noteKey(note("wrong", "Wrong year", "In 1999!")),
    noteKey(note("wrong", "totally wrong year", "in 1999")),
  );
  assert.notEqual(noteKey(note("wrong", "X", "a")), noteKey(note("outdated", "X", "a")));
});

test("persona prefixes are the verbatim council text and buildCouncilPrompt prepends them", async () => {
  const { PERSONA_PREFIX, buildCouncilPrompt } = await load();
  assert.equal(PERSONA_PREFIX.quickdraw, personas.quickdraw);
  assert.equal(PERSONA_PREFIX.scholar, personas.scholar);

  const { system, user } = buildCouncilPrompt("scholar", "SCRIPT-BODY", "BRIEFING-BODY");
  assert.ok(system.startsWith(`${personas.scholar}\n\n`));
  assert.ok(system.includes('"missing-context"'), "same checker instructions for every persona");
  assert.ok(user.includes("SCRIPT-BODY") && user.includes("BRIEFING-BODY"));
  assert.ok(user.includes("VETTED TRUSTED-SOURCE INDEX:") && user.includes("https://www.archives.gov/"));
  const quick = buildCouncilPrompt("quickdraw", "s", "same sources");
  const scholar = buildCouncilPrompt("scholar", "s", "same sources");
  assert.equal(quick.user, scholar.user, "all council checkers receive the same source text");
});

test("councilVerdict follows the unanimous rule", async () => {
  const { councilVerdict } = await load();
  assert.equal(councilVerdict({ upheld: [], dismissed: [] }), "pass");
  assert.equal(
    councilVerdict({
      upheld: [],
      dismissed: [{ flag: flag("scholar", "wrong", "x", "x"), reason: "not so", flagger_agrees: true }],
    }),
    "pass",
    "a dismissal the flagger accepts is a clean pass",
  );
  assert.equal(councilVerdict({ upheld: [flag("quickdraw", "wrong", "x", "x")], dismissed: [] }), "fail");
  assert.equal(
    councilVerdict({
      upheld: [],
      dismissed: [{ flag: flag("scholar", "wrong", "x", "x"), reason: "not so", flagger_agrees: false }],
    }),
    "fail",
    "a disputed dismissal still fails",
  );
});

test("owner grade overrides retain the automatic score and bound notes", async () => {
  const { overrideScriptGrade } = await load();
  const grade = { score: "B", tags: [], error_types: [], caught_by: {}, notes: "Auto" };
  assert.deepEqual(overrideScriptGrade(grade, "D", "  Owner review  "), {
    ...grade, score: "D", auto_score: "B", notes: "Owner review", owner_override: true,
  });
});

test("automatic grades tag topic, format, error type, and catching persona", async () => {
  const { gradeScript } = await load();
  const value = submission({
    members: [member("quickdraw", [note("wrong", "Wrong year")]), member("scholar")],
    upheld: [flag("quickdraw", "wrong", "Wrong year")],
    verdict: "fail",
    tags: ["topic:history", "format:interview"],
  });
  const grade = gradeScript(value, []);
  assert.deepEqual(grade.tags, ["caught:quickdraw", "error:wrong", "format:interview", "topic:history"]);
});

test("validateCouncilSubmission accepts and normalizes a well-formed result", async () => {
  const checked = await accepted({
    upheld: [flag("quickdraw", "wrong", "  Wrong year  ", "  in 1999  ")],
    tags: [" Space ", "SPACE", "Interview"],
    verdict: "fail",
  });
  assert.equal(checked.verdict, "fail");
  assert.deepEqual(checked.upheld[0], { persona: "quickdraw", kind: "wrong", message: "Wrong year", excerpt: "in 1999" });
  assert.deepEqual(checked.tags, ["space", "interview"]);
});

test("validateCouncilSubmission accepts an optional qwen voter", async () => {
  const checked = await accepted({
    members: [member("quickdraw"), member("scholar"), member("qwen")],
    verdict: "fail",
    upheld: [flag("qwen", "unsupported", "No source for the number", "40%")],
  });
  assert.equal(checked.verdict, "fail");
  assert.equal(checked.members.length, 3);
  assert.equal(checked.upheld[0].persona, "qwen");

  const { gradeScript, mergeCouncilResult } = await load();
  const grade = gradeScript(checked, []);
  assert.equal(grade.caught_by.qwen, 1, "Qwen's flags are counted when it votes");
  assert.equal(grade.score, "C");
  const merged = mergeCouncilResult(null, checked, new Date("2026-02-02T00:00:00.000Z"));
  assert.deepEqual(merged.council.voted, ["quickdraw", "scholar", "qwen"]);
});

test("validateCouncilSubmission rejects malformed submissions", async () => {
  const { validateCouncilSubmission } = await load();
  const bad = [
    [{}, "both"],
    [submission({ members: [member("quickdraw")] }), "Quickdraw and Scholar"],
    [submission({ members: [member("quickdraw"), member("quickdraw")] }), "once"],
    [submission({ members: [member("quickdraw"), { ...member("scholar"), notes: [note("style", "bad kind", "x")] }] }), "known kind"],
    [submission({ upheld: [flag("quickdraw", "typo", "Bad", "x")], verdict: "fail" }), "upheld flag"],
    [submission({ upheld: [flag("lead", "wrong", "x", "x")], verdict: "fail" }), "did not report"],
    [submission({ dismissed: [{ flag: flag("scholar", "wrong", "x", "x"), reason: "  ", flagger_agrees: true }] }), "reason"],
    [submission({ dismissed: [{ flag: flag("scholar", "wrong", "x", "x"), reason: "ok", flagger_agrees: "yes" }] }), "flagger agrees"],
    [submission({ tags: ["x".repeat(33)] }), "32 characters"],
    [submission({ added_sources: [{ url: "https://x.test", by: "nobody", accepted: true }] }), "persona"],
    [submission({ verdict: "maybe" }), "Verdict must be pass or fail"],
  ];
  for (const [body, expected] of bad) {
    const result = validateCouncilSubmission(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.match(result.error, new RegExp(expected, "i"), JSON.stringify(body));
  }

  const mismatch = validateCouncilSubmission(
    submission({ upheld: [flag("quickdraw", "wrong", "Wrong", "x")] }), // verdict left as pass
  );
  assert.deepEqual(mismatch, { ok: false, error: "verdict does not follow the unanimous rule" });
});

test("gradeScript: A for a clean pass, with deterministic tags and zero counts", async () => {
  const { gradeScript } = await load();
  const s = await accepted({ tags: ["Space", "space", "Interview"] });
  const grade = gradeScript(s, []);
  assert.equal(grade.score, "A");
  assert.deepEqual(grade.tags, ["interview", "space"]);
  assert.deepEqual(grade.error_types, []);
  assert.deepEqual(grade.caught_by, { quickdraw: 0, scholar: 0, lead: 0, free_models: 0 });
  assert.equal(grade.notes, "Pass: no flags.");
  assert.deepEqual(grade, gradeScript(s, []), "no clocks or randomness in a grade");
});

test("gradeScript: B for a pass after false positives are dismissed", async () => {
  const { gradeScript } = await load();
  const s = await accepted({
    dismissed: [
      {
        flag: flag("scholar", "unsupported", "No source for 40%", "forty percent"),
        reason: "Briefing page 3 gives that number.",
        flagger_agrees: true,
      },
    ],
  });
  const grade = gradeScript(s, [note("outdated", "layer one", "old")]);
  assert.equal(grade.score, "B");
  assert.deepEqual(grade.error_types, [], "dismissed flags are not errors");
  assert.deepEqual(grade.caught_by, { quickdraw: 0, scholar: 0, lead: 0, free_models: 1 });
  assert.match(grade.notes, /false positive dismissed/);
});

test("gradeScript: C for 1-2 minor flags, with error types and per-persona counts", async () => {
  const { gradeScript } = await load();
  const s = await accepted({
    verdict: "fail",
    upheld: [
      flag("quickdraw", "unsupported", "No source", "40%"),
      flag("scholar", "missing-context", "Missing caveat", "always"),
    ],
  });
  const grade = gradeScript(s, []);
  assert.equal(grade.score, "C");
  assert.deepEqual(grade.error_types, ["unsupported", "missing-context"]);
  assert.deepEqual(grade.caught_by, { quickdraw: 1, scholar: 1, lead: 0, free_models: 0 });
  assert.match(grade.notes, /2 minor flags/);
});

test("gradeScript: D for one major flag", async () => {
  const { gradeScript } = await load();
  const s = await accepted({ verdict: "fail", upheld: [flag("quickdraw", "wrong", "Wrong year", "1999")] });
  const grade = gradeScript(s, []);
  assert.equal(grade.score, "D");
  assert.deepEqual(grade.error_types, ["wrong"]);
  assert.equal(grade.caught_by.quickdraw, 1);
  assert.equal(grade.notes, "Fail: Quickdraw flagged 1 wrong fact.");
});

test("gradeScript: D for more than two minor flags", async () => {
  const { gradeScript } = await load();
  const s = await accepted({
    members: [member("quickdraw"), member("scholar"), member("lead")],
    verdict: "fail",
    upheld: [
      flag("quickdraw", "unsupported", "No source", "a"),
      flag("scholar", "unsupported", "No source", "b"),
      flag("lead", "missing-context", "No caveat", "c"),
    ],
  });
  const grade = gradeScript(s, []);
  assert.equal(grade.score, "D");
  assert.deepEqual(grade.caught_by, { quickdraw: 1, scholar: 1, lead: 1, free_models: 0 });
  assert.match(grade.notes, /3 minor flags/);
});

test("gradeScript: F for multiple major flags, including disputed dismissals", async () => {
  const { gradeScript } = await load();
  const s = await accepted({
    verdict: "fail",
    upheld: [flag("quickdraw", "wrong", "Wrong year", "1999")],
    dismissed: [
      {
        flag: flag("scholar", "outdated", "Superseded figure", "2020 figure"),
        reason: "The Lead says this changed.",
        flagger_agrees: false,
      },
    ],
  });
  const grade = gradeScript(s, [note("wrong", "layer one", "x"), note("unsupported", "layer one", "y")]);
  assert.equal(grade.score, "F");
  assert.deepEqual(grade.error_types, ["wrong", "outdated"]);
  assert.deepEqual(grade.caught_by, { quickdraw: 1, scholar: 1, lead: 0, free_models: 2 });
  assert.equal(grade.notes, "Fail: 2 major factual errors.");
});

test("mergeCouncilResult: unanimous clean review passes and clears old council fields", async () => {
  const { mergeCouncilResult } = await load();
  const existing = {
    notes: [note("wrong", "Layer one", "old")],
    model: "free-a, free-b",
    checked_at: "2026-01-01T00:00:00.000Z",
    agent_notes: [flag("lead", "wrong", "Old flag", "old")],
    verdict: "fail",
    council: { verdict: "fail", voted: ["quickdraw", "scholar"], decided_at: "2026-01-01T00:00:00.000Z" },
    added_sources: [{ url: "https://old.test", by: "lead", accepted: false }],
  };
  const s = await accepted({
    tags: ["space"],
    added_sources: [{ url: "https://new.test", by: "scholar", accepted: true }],
  });
  const merged = mergeCouncilResult(existing, s, new Date("2026-02-02T00:00:00.000Z"));

  assert.equal(merged.verdict, "pass");
  assert.deepEqual(merged.notes, existing.notes);
  assert.equal(merged.model, existing.model);
  assert.equal(merged.checked_at, existing.checked_at);
  assert.deepEqual(merged.agent_notes, [], "no surviving flags");
  assert.deepEqual(merged.added_sources, s.added_sources, "replaces, not appends");
  assert.deepEqual(merged.council, {
    verdict: "pass",
    voted: ["quickdraw", "scholar"],
    decided_at: "2026-02-02T00:00:00.000Z",
  });
  assert.equal(merged.grade.score, "A");
  assert.equal(merged.grade.caught_by.free_models, 1);
});

test("mergeCouncilResult: any surviving flag fails; duplicate flags collapse via noteKey", async () => {
  const { mergeCouncilResult } = await load();
  const s = await accepted({
    members: [member("quickdraw"), member("scholar"), member("lead")],
    verdict: "fail",
    upheld: [
      flag("quickdraw", "wrong", "Wrong year", "in 1999"),
      flag("scholar", "wrong", "The year is wrong", "in 1999"),
      flag("lead", "unsupported", "No source", "40%"),
    ],
  });
  const merged = mergeCouncilResult(null, s, new Date("2026-02-02T00:00:00.000Z"));

  assert.equal(merged.verdict, "fail");
  assert.equal(merged.agent_notes.length, 2, "same kind + excerpt deduped across personas");
  assert.equal(merged.agent_notes[0].persona, "quickdraw");
  assert.deepEqual(merged.notes, []);
  assert.equal(merged.model, null);
  assert.equal(merged.checked_at, "2026-02-02T00:00:00.000Z");
  assert.equal(merged.grade.score, "F", "two personas upheld the same major error, so two majors");
  assert.equal(merged.grade.error_types.length, 2);
});

test("mergeCouncilResult: a disputed dismissal survives as a Lead-reviewed flag", async () => {
  const { mergeCouncilResult } = await load();
  const s = await accepted({
    verdict: "fail",
    dismissed: [
      {
        flag: flag("scholar", "outdated", "Old policy", "old policy"),
        reason: "Policy changed in 2025.",
        flagger_agrees: false,
      },
    ],
  });
  const merged = mergeCouncilResult(null, s, new Date("2026-02-02T00:00:00.000Z"));
  assert.equal(merged.verdict, "fail");
  assert.equal(merged.agent_notes.length, 1);
  assert.equal(merged.agent_notes[0].persona, "scholar");
  assert.equal(merged.dismissed[0].reason, "Policy changed in 2025.");
  assert.equal(merged.grade.score, "D");
});
