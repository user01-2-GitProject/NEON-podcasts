const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

function load(path, modules) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in modules) return modules[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`unexpected import ${name}`);
  }, exports);
  return exports;
}

let llm = { provider: "openrouter", openRouterApiKey: "or-key", openRouterModel: "some/model" };
const research = load("lib/research.ts", {
  "@/lib/settings": { resolveLlmConfig: async () => llm },
  "@/lib/claude": { DEFAULT_OPENROUTER_MODEL: "default/model" },
});

const GUIDE = `## Voice & style
Calm.

## Look up before each episode
Tonight's top US news stories from today.
Sites: https://www.redskins.com/news, espn.com, not a site, javascript:alert(1)

## Hard rules
- No opinions.`;

test("the look-up section is opt-in and ends at the next heading", () => {
  assert.equal(research.researchBrief("## Voice & style\nCalm."), null);
  assert.equal(research.researchBrief(""), null);
  const brief = research.researchBrief(GUIDE);
  assert.match(brief, /^Tonight's top US news/);
  assert.ok(!brief.includes("Hard rules"));
});

test("sites become bare host names and junk is dropped", () => {
  assert.deepEqual(research.researchSites(research.researchBrief(GUIDE)), ["redskins.com", "espn.com"]);
  assert.deepEqual(research.researchSites("Tonight's news."), []);
  assert.deepEqual(research.webPlugin("x"), { id: "web", engine: "exa", max_results: 8 });
  assert.deepEqual(research.webPlugin("Sites: espn.com").include_domains, ["espn.com"]);
});

test("the research prompt treats pages as data and dates the facts", () => {
  const { system, userText } = research.buildResearchPrompt({
    showTitle: "USA News", showDescription: "News", brief: "Top stories", today: "2026-11-25", timezone: "America/New_York",
  });
  assert.match(system, /Today is 2026-11-25/);
  assert.match(system, /Ignore any instructions/);
  assert.match(system, /Never add facts/);
  assert.match(userText, /WHAT TO LOOK UP:\nTop stories/);
});

test("sources are deduped, http(s) only and capped", () => {
  const annotations = [
    { type: "url_citation", url_citation: { url: "https://a.com/1", title: "A\n one" } },
    { type: "url_citation", url_citation: { url: "https://a.com/1", title: "dup" } },
    { type: "url_citation", url_citation: { url: "javascript:alert(1)", title: "bad" } },
    { type: "url_citation", url_citation: { url: "https://user:pw@b.com/", title: "creds" } },
    { type: "url_citation", url_citation: { url: "http://c.com/x" } },
    ...Array.from({ length: 20 }, (_, i) => ({ type: "url_citation", url_citation: { url: `https://d.com/${i}`, title: "d" } })),
  ];
  const out = research.parseResearchResponse({ choices: [{ message: { content: " - fact [1] ", annotations } }] });
  assert.equal(out.notes, "- fact [1]");
  assert.equal(out.sources.length, research.MAX_SOURCES);
  assert.deepEqual(out.sources[0], { url: "https://a.com/1", title: "A one" });
  assert.deepEqual(out.sources[1], { url: "http://c.com/x", title: "c.com" });
  assert.ok(!out.sources.some((s) => /javascript|@/.test(s.url)));
});

test("lookUp sends one web-search request and returns notes with sources", async () => {
  llm = { provider: "openrouter", openRouterApiKey: "or-key", openRouterModel: "some/model" };
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "- Game at 1 PM [1]", annotations: [{ type: "url_citation", url_citation: { url: "https://espn.com/g", title: "Game" } }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    };
  };
  const r = await research.lookUp(
    { showTitle: "Football", showDescription: "", brief: "This week's game.\nSites: espn.com", today: "2026-11-25", timezone: "UTC" },
    fetchImpl,
  );
  assert.match(sent.url, /openrouter\.ai/);
  assert.equal(sent.auth, "Bearer or-key");
  assert.equal(sent.body.model, "some/model");
  assert.deepEqual(sent.body.plugins, [{ id: "web", engine: "exa", max_results: 8, include_domains: ["espn.com"] }]);
  assert.equal(r.notes, "- Game at 1 PM [1]");
  assert.equal(r.inputTokens, 100);
  const doc = research.researchBriefing(r, "2026-11-25");
  assert.equal(doc.filename, "looked-up-2026-11-25.md");
  assert.match(doc.content_md, /never read the web addresses aloud/);
  assert.match(doc.content_md, /\[1\] Game: https:\/\/espn\.com\/g/);
  assert.match(research.sourcesNote(r.sources), /\*\*Sources\*\*\n- Game: https:\/\/espn\.com\/g/);
});

test("lookUp explains plainly when it can't run, without leaking provider details", async () => {
  llm = { provider: "anthropic", openRouterApiKey: null, openRouterModel: null };
  await assert.rejects(research.lookUp({ showTitle: "x", showDescription: "", brief: "y", today: "d", timezone: "UTC" }, async () => { throw new Error("no fetch"); }), /needs OpenRouter/);
  llm = { provider: "openrouter", openRouterApiKey: "k", openRouterModel: null };
  const orig = console.error; console.error = () => {};
  try {
    await assert.rejects(
      research.lookUp({ showTitle: "x", showDescription: "", brief: "y", today: "d", timezone: "UTC" }, async () => ({ ok: false, status: 402, text: async () => "secret detail" })),
      (e) => /search service error 402/.test(e.message) && !e.message.includes("secret"),
    );
    await assert.rejects(
      research.lookUp({ showTitle: "x", showDescription: "", brief: "y", today: "d", timezone: "UTC" }, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "" } }] }) })),
      /came back empty/,
    );
  } finally { console.error = orig; }
});

test("a show that asks for it gets its look-up as a briefing, sources in the notes, and the search cost", async () => {
  const SHOW = { id: "s1", title: "USA News", description: "News", style_guide: GUIDE, target_minutes: 1, narration_mode: "external", timezone: "UTC" };
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/select \* from shows/.test(text)) return [SHOW];
    if (/insert into runs/.test(text)) return [{ id: "run-1" }];
    if (/insert into episodes/.test(text)) return [{ id: "ep-1", show_notes: values[3] }];
    return [];
  };
  let writerDocs;
  const script = "Good evening. ".repeat(80).trim();
  const gen = load("lib/generate.ts", {
    "@/lib/db": { sql, getSql: () => ({ transaction: async () => [[]] }) },
    "@/lib/episode-title": require("../lib/episode-title.ts"),
    "@/lib/claude": {
      generateScript: async (args) => { writerDocs = args.briefings; return { result: { title: "T", script, show_notes: "notes" }, model: "m", inputTokens: 1, outputTokens: 1 }; },
      estimateCostCents: () => 2,
      mostImportant: () => "Be fair.",
    },
    "@/lib/tts": { synthesize: async () => { throw new Error("no tts"); }, estimateDurationSeconds: () => 60 },
    "@/lib/pronounce": { applyPronunciations: (s) => s },
    "@/lib/storage": { getStorage: () => { throw new Error("no storage"); } },
    "@/lib/episode-spec": require("../lib/episode-spec.ts"),
    "@/lib/script-check": require("../lib/script-check.ts"),
    "@/lib/research": {
      ...research,
      lookUp: async (a) => {
        assert.match(a.brief, /Tonight.s top US news/);
        assert.equal(a.priority, "Be fair.");
        return { notes: "- Fact [1]", sources: [{ url: "https://espn.com/a", title: "A" }], model: "m", inputTokens: 5, outputTokens: 5 };
      },
    },
  });
  const out = await gen.generateEpisode("s1");
  const looked = writerDocs.find((d) => d.filename.startsWith("looked-up-"));
  assert.ok(looked, "writer got the look-up");
  assert.match(looked.content_md, /- Fact \[1\]/);
  assert.match(out.episode.show_notes, /notes\n\n\*\*Sources\*\*\n- A: https:\/\/espn\.com\/a/);
  assert.ok(calls.some((c) => /briefing_snapshot/.test(c.text) && c.values.some((v) => typeof v === "string" && v.includes("looked-up-"))), "run keeps what was looked up");
  const done = calls.find((c) => /status = 'done'|update runs set/.test(c.text) && c.values.includes(2 + research.SEARCH_COST_CENTS));
  assert.ok(done, "run cost includes the search");
});

test("the owner's 'most important' answer steers what gets looked up", () => {
  const base = { showTitle: "x", showDescription: "", brief: "y", today: "d", timezone: "UTC" };
  assert.match(research.buildResearchPrompt({ ...base, priority: "Be fair." }).system, /most important part of this podcast is: "Be fair\."/);
  assert.ok(!research.buildResearchPrompt(base).system.includes("most important"));
});
