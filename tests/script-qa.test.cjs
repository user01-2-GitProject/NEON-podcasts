const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../lib/script-qa.ts");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const GUIDE_WITH_RULE = [
  "## Who's going",
  "Me, Sarah and the kids: Ava (8) and Leo (5)",
  "",
  "Don't say my name on the show.",
].join("\n");

test("local QA catches swears and lines over 400 characters", async () => {
  const { localQaNotes, MAX_QA_LINE } = await load();
  assert.equal(MAX_QA_LINE, 400);
  const clean = localQaNotes("Welcome back. Today we look at trains and buses.", null);
  assert.deepEqual(clean, []);

  const dirty = `This is a damn fine train. ${"A".repeat(405)}`;
  const notes = localQaNotes(dirty, null);
  assert.ok(notes.some((n) => n.kind === "swear" && /damn/.test(n.message)), JSON.stringify(notes));
  const line = notes.find((n) => n.kind === "long-line");
  assert.ok(line, "a 400+ character line is flagged");
  assert.match(line.message, /Line 1 is 4\d\d characters/);
  assert.ok(line.excerpt.length <= 160);
});

test("the host's own name is flagged only when Who's going forbids names", async () => {
  const { whosGoing, forbidsNames, namesIn, localQaNotes } = await load();
  const section = whosGoing(GUIDE_WITH_RULE);
  assert.match(section, /Sarah/);
  assert.equal(forbidsNames(section), true);
  assert.ok(namesIn(section).includes("Sarah"));

  const intro = "Welcome back. I'm Sarah, and today we look at trains.";
  const flagged = localQaNotes(intro, GUIDE_WITH_RULE);
  assert.ok(flagged.some((n) => n.kind === "self-name" && /Sarah/.test(n.message)), JSON.stringify(flagged));

  const withoutRule = GUIDE_WITH_RULE.replace("Don't say my name on the show.", "Say hello to everyone.");
  assert.equal(forbidsNames(whosGoing(withoutRule)), false);
  assert.deepEqual(localQaNotes(intro, withoutRule), []);
  assert.deepEqual(localQaNotes(intro, null), []);
});

test("model replies are parsed into bounded, safe notes", async () => {
  const { parseQaNotes } = await load();
  const reply = [
    "Here you go:",
    "```json",
    JSON.stringify({
      notes: [
        { kind: "number", message: "Read 2026 as twenty twenty six.", excerpt: "In 2026 we go" },
        { kind: "number", message: "Read 2026 as twenty twenty six.", excerpt: "In 2026 we go" },
        { kind: "joke", message: "not a QA kind" },
        { kind: "swear", message: "  A\nlong   explanation ".padEnd(300, "x"), excerpt: "x".repeat(400) },
        { message: "no kind" },
      ],
    }),
    "```",
  ].join("\n");
  const notes = parseQaNotes(reply);
  assert.equal(notes.length, 2, "duplicates and unknown kinds are dropped");
  assert.equal(notes[0].kind, "number");
  assert.equal(notes[1].kind, "swear");
  assert.ok(notes[1].message.length <= 240);
  assert.ok(notes[1].excerpt.length <= 160);
  assert.ok(!/[\n\r]/.test(notes[1].message));
  assert.deepEqual(parseQaNotes("the model refused in plain English"), []);
  assert.deepEqual(parseQaNotes('{"notes":"none"}'), []);
});

test("the cheap prompt asks about years, acronyms and the Who's going rule", async () => {
  const { buildQaPrompt } = await load();
  const { system, user } = buildQaPrompt("In 2026 the SEC met.", GUIDE_WITH_RULE);
  assert.match(system, /JSON/);
  assert.match(system, /at most 8 notes/);
  assert.match(user, /twenty twenty six/);
  assert.match(user, /two thousand twenty six/);
  assert.match(user, /acronym/i);
  assert.match(user, /400 characters/);
  assert.match(user, /Who's going/);
  assert.match(user, /Sarah/);
});

test("the model pass uses a small OpenRouter model and merges local cross-checks", async () => {
  const { runScriptQa, DEFAULT_QA_MODEL } = await load();
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ notes: [{ kind: "number", message: "2026 should be twenty twenty six.", excerpt: "In 2026" }] }) } }],
      }),
    };
  };
  const qa = await runScriptQa({
    script: 'In 2026 the host said "damn".',
    styleGuide: GUIDE_WITH_RULE,
    config: { openRouterApiKey: "test-key" },
    fetchImpl: fakeFetch,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/openrouter\.ai\//);
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, process.env.OPENROUTER_QA_MODEL || DEFAULT_QA_MODEL);
  assert.ok(body.max_tokens <= 1000, "the QA pass stays cheap");
  assert.equal(qa.model, body.model);
  assert.ok(qa.checked_at);
  assert.deepEqual(qa.notes.map((n) => n.kind).sort(), ["number", "swear"]);
});

test("a provider failure falls back to local notes without leaking the error", async () => {
  const { runScriptQa } = await load();
  const original = console.error;
  console.error = () => {};
  try {
    const qa = await runScriptQa({
      script: "This is damn good.\n" + "B".repeat(401),
      config: { openRouterApiKey: "test-key" },
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => "secret provider detail" }),
    });
    assert.equal(qa.model, null);
    assert.ok(qa.notes.length >= 2);
    const text = JSON.stringify(qa);
    assert.ok(!/secret provider detail/.test(text), "raw provider errors never reach a note");
    assert.ok(!text.includes("test-key"), "the API key is never echoed");
  } finally {
    console.error = original;
  }
});

test("no OpenRouter key still produces local notes, with no fetch", async () => {
  const { runScriptQa } = await load();
  const qa = await runScriptQa({
    script: "This is a damn fine train.",
    config: { openRouterApiKey: null },
    fetchImpl: async () => { throw new Error("should not be called"); },
  });
  assert.equal(qa.model, null);
  assert.equal(qa.notes.length, 1);
  assert.equal(qa.notes[0].kind, "swear");
});

test("generation writes QA notes, returns a run id, and the owner sees a pill", () => {
  const generate = read("lib/generate.ts");
  assert.match(generate, /import \{ runScriptQa, type ScriptQa \}/);
  assert.match(generate, /const scriptQa = await runScriptQa\(\{ script: result\.script, styleGuide: show\.style_guide \}\)/);
  assert.ok((generate.match(/script_qa = \$\{qaJson\}/g) || []).length >= 5, "every finished-run update stores QA");
  // The older script check is still there and still drives rewrites.
  assert.match(generate, /checkScript\(result\.script, show\.target_minutes\)/);
  assert.match(generate, /needsRewrite\(issues\)/);

  const route = read("app/api/shows/[id]/generate/route.ts");
  assert.match(route, /after\(\(\) => runGenerationInBackground/);
  assert.match(route, /NextResponse\.json\(\{ runId \}, \{ status: 202 \}\)/);
  const runRoute = read("app/api/runs/[id]/route.ts");
  for (const field of ["status", "model", "error", "episodeId", "startedAt", "finishedAt"]) {
    assert.match(runRoute, new RegExp(`${field}:`));
  }

  const panel = read("components/EpisodesPanel.tsx");
  assert.match(panel, /className="tag qa"/);
  assert.match(panel, /QA note\{qa\.notes\.length === 1 \? "" : "s"\}/);
  assert.match(panel, /<details className="qa-notes">/);
  assert.match(panel, /qaForEpisode\(ep\.id, qaRuns\)/);

  const page = read("app/shows/[id]/page.tsx");
  assert.match(page, /script_qa is not null/);
  assert.match(page, /qaRuns=\{qaRuns\}/);

  const types = read("lib/types.ts");
  assert.match(types, /script_qa: ScriptQa \| null/);
  const migration = read("db/migrations/015_script_qa.sql");
  assert.match(migration, /alter table runs add column if not exists script_qa jsonb/i);
  const css = read("app/globals.css");
  assert.match(css, /\.tag\.qa \{/);
});
