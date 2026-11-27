const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../lib/fact-check.ts");

const note = (kind, message, excerpt) => ({ kind, message, ...(excerpt ? { excerpt } : {}) });

test("buildFactCheckPrompt names all four kinds and includes script and briefing", async () => {
  const { buildFactCheckPrompt } = await load();
  const { system, user } = buildFactCheckPrompt("SCRIPT-BODY", "BRIEFING-BODY");
  for (const kind of ["wrong", "unsupported", "outdated", "missing-context"]) {
    assert.ok(system.includes(`"${kind}"`), `system names ${kind}`);
  }
  assert.ok(user.includes("SCRIPT-BODY"));
  assert.ok(user.includes("BRIEFING-BODY"));
});

test("buildFactCheckPrompt truncates script and briefing to 10,000 chars each", async () => {
  const { buildFactCheckPrompt } = await load();
  const { user } = buildFactCheckPrompt("s".repeat(12_000), "b".repeat(15_000));
  const scriptRun = /s{10000,}/.exec(user)[0];
  const briefingRun = /b{10000,}/.exec(user)[0];
  assert.equal(scriptRun.length, 10_000);
  assert.equal(briefingRun.length, 10_000);
});

test("parseFactCheckNotes reads JSON inside prose and code fences", async () => {
  const { parseFactCheckNotes } = await load();
  const json = '{"notes":[{"kind":"wrong","message":"Wrong year","excerpt":"in 1999"}]}';
  const expected = [{ kind: "wrong", message: "Wrong year", excerpt: "in 1999" }];
  assert.deepEqual(parseFactCheckNotes(json), expected);
  assert.deepEqual(parseFactCheckNotes(`Here you go:\n${json}\nHope that helps.`), expected);
  assert.deepEqual(parseFactCheckNotes("```json\n" + json + "\n```"), expected);
});

test("parseFactCheckNotes drops unknown kinds and empty messages", async () => {
  const { parseFactCheckNotes } = await load();
  const text = JSON.stringify({
    notes: [
      { kind: "style", message: "Too long" },
      { kind: "wrong", message: "   " },
      { kind: "wrong" },
      { kind: "unsupported", message: "No source for 40%" },
    ],
  });
  assert.deepEqual(parseFactCheckNotes(text), [
    { kind: "unsupported", message: "No source for 40%" },
  ]);
});

test("parseFactCheckNotes trims message to 240 and excerpt to 160", async () => {
  const { parseFactCheckNotes } = await load();
  const text = JSON.stringify({
    notes: [{ kind: "outdated", message: "m".repeat(500), excerpt: "e".repeat(500) }],
  });
  const [n] = parseFactCheckNotes(text);
  assert.equal(n.message.length, 240);
  assert.equal(n.excerpt.length, 160);
});

test("parseFactCheckNotes returns [] on garbage", async () => {
  const { parseFactCheckNotes } = await load();
  assert.deepEqual(parseFactCheckNotes(""), []);
  assert.deepEqual(parseFactCheckNotes("no json here"), []);
  assert.deepEqual(parseFactCheckNotes("{not valid json}"), []);
  assert.deepEqual(parseFactCheckNotes('{"notes":"nope"}'), []);
  assert.deepEqual(parseFactCheckNotes("[1,2,3]"), []);
});

test("aggregateNotes keeps notes flagged by 2 of 3 lists with agreed: 2", async () => {
  const { aggregateNotes } = await load();
  const a = [note("wrong", "Year is wrong", "in 1999"), note("unsupported", "Only A saw this", "forty percent")];
  const b = [note("wrong", "The year is wrong here", "in 1999")];
  const c = [];
  const out = aggregateNotes([a, b, c], 2);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "wrong");
  assert.equal(out[0].agreed, 2);
  assert.equal(out[0].message, "The year is wrong here", "longest message wins");
});

test("aggregateNotes drops notes flagged by only one list at minAgreement 2", async () => {
  const { aggregateNotes } = await load();
  const out = aggregateNotes([[note("wrong", "x", "alpha")], [note("wrong", "y", "beta")]], 2);
  assert.deepEqual(out, []);
});

test("aggregateNotes counts duplicates inside one list once", async () => {
  const { aggregateNotes } = await load();
  const dup = [note("wrong", "Same", "same excerpt"), note("wrong", "Same", "same excerpt")];
  assert.deepEqual(aggregateNotes([dup], 2), []);
  const out = aggregateNotes([dup, [note("wrong", "Same", "same excerpt")]], 2);
  assert.equal(out[0].agreed, 2);
});

test("aggregateNotes caps at 8 notes sorted by agreement descending", async () => {
  const { aggregateNotes } = await load();
  const many = (n) => Array.from({ length: n }, (_, i) => note("unsupported", `claim ${i}`, `excerpt${String.fromCharCode(97 + i)}`));
  const popular = note("wrong", "Everyone saw it", "popular excerpt");
  const lists = [[...many(10), popular], [...many(10), popular], [popular]];
  const out = aggregateNotes(lists, 2);
  assert.equal(out.length, 8);
  assert.equal(out[0].agreed, 3);
  assert.equal(out[0].excerpt, "popular excerpt");
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].agreed >= out[i].agreed);
});

const FREE = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "baidu/ernie-5.5-flash-preview:free",
];

function reply(notes) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ notes }) } }] }),
  };
}

function mockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const model = JSON.parse(init.body).model;
    calls.push(model);
    return handler(model);
  };
  return { fetchImpl, calls };
}

test("runFactCheck skips fetch on an empty briefing", async () => {
  const { runFactCheck } = await load();
  const { fetchImpl, calls } = mockFetch(() => reply([]));
  const out = await runFactCheck({
    script: "s",
    briefingSnapshot: "   ",
    config: { openRouterApiKey: "k" },
    fetchImpl,
  });
  assert.deepEqual(out.notes, []);
  assert.equal(out.model, null);
  assert.equal(calls.length, 0);
});

test("runFactCheck skips fetch with no API key", async () => {
  const { runFactCheck } = await load();
  const { fetchImpl, calls } = mockFetch(() => reply([]));
  const out = await runFactCheck({
    script: "s",
    briefingSnapshot: "briefing",
    config: { openRouterApiKey: null },
    fetchImpl,
  });
  assert.deepEqual(out.notes, []);
  assert.equal(out.model, null);
  assert.equal(calls.length, 0);
});

test("runFactCheck aggregates three free models and lists them all", async () => {
  const { runFactCheck } = await load();
  const shared = note("wrong", "Wrong year", "in 1999");
  const { fetchImpl, calls } = mockFetch((model) =>
    reply(model === FREE[2] ? [] : [shared, ...(model === FREE[0] ? [note("unsupported", "Solo", "solo")] : [])]),
  );
  const out = await runFactCheck({
    script: "s",
    briefingSnapshot: "briefing",
    config: { openRouterApiKey: "k" },
    fetchImpl,
  });
  assert.deepEqual(calls.slice().sort(), FREE.slice().sort());
  assert.equal(out.model, FREE.join(", "));
  assert.equal(out.notes.length, 1);
  assert.equal(out.notes[0].agreed, 2);
  assert.equal(out.notes[0].kind, "wrong");
  assert.ok(!Number.isNaN(Date.parse(out.checked_at)));
});

test("runFactCheck falls back to one gpt-4o-mini call when only one free model answers", async () => {
  const { runFactCheck } = await load();
  const n = note("wrong", "Bad number", "ten");
  const { fetchImpl, calls } = mockFetch((model) => {
    if (model === FREE[0]) return reply([n]);
    if (model === "openai/gpt-4o-mini") return reply([n]);
    return { ok: false, json: async () => ({}) };
  });
  const out = await runFactCheck({
    script: "s",
    briefingSnapshot: "briefing",
    config: { openRouterApiKey: "k" },
    fetchImpl,
  });
  assert.equal(calls.filter((m) => m === "openai/gpt-4o-mini").length, 1);
  assert.equal(out.model, "openai/gpt-4o-mini");
  assert.equal(out.notes.length, 1);
});

test("runFactCheck returns empty when every model fails", async () => {
  const { runFactCheck } = await load();
  const { fetchImpl, calls } = mockFetch(() => ({ ok: false, json: async () => ({}) }));
  const out = await runFactCheck({
    script: "s",
    briefingSnapshot: "briefing",
    config: { openRouterApiKey: "k" },
    fetchImpl,
  });
  assert.deepEqual(out.notes, []);
  assert.equal(out.model, null);
  assert.equal(calls.length, 4);
});
