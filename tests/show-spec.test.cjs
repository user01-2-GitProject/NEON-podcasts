const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, writeFileSync } = require("node:fs");
const ts = require("typescript");

function load(path, requireFn) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObj = {};
  new Function("require", "exports", compiled)(requireFn, exportsObj);
  return exportsObj;
}

const spec = load("lib/show-spec.ts", (n) => {
  throw new Error(`unexpected require: ${n}`);
});
const { buildPrompt } = load("lib/claude.ts", (name) => {
  if (name === "@/lib/settings") return { resolveLlmConfig: async () => ({ provider: "anthropic" }) };
  if (name === "@/lib/request-timeout") return { withRequestTimeout: (_label, request) => request(new AbortController().signal) };
  if (name === "@anthropic-ai/sdk") return {};
  throw new Error(`unexpected require: ${name}`);
});

const EXAMPLE = readFileSync("templates/show.example.md", "utf8");

test("the example show.md parses with no errors", () => {
  const { spec: s, errors } = spec.parseShowMd(EXAMPLE);
  assert.deepEqual(errors, []);
  assert.equal(s.title, "5:01 Diamond Hands");
  assert.equal(s.cadence, "daily");
  assert.equal(s.schedule_time, "17:01");
  assert.equal(s.timezone, "America/New_York");
  assert.equal(s.target_minutes, 12);
  assert.equal(s.explicit, false);
  assert.deepEqual(s.hosts, [{ name: "Iggy", voice: "iggy-v2" }]);
  assert.deepEqual(s.pronunciations[1], { term: "0DTE", say_as: "zero D T E", match: "word" });
  assert.deepEqual(s.tags, ["markets", "investing", "daily"]);
  assert.match(s.body, /^## Voice & style/);
  assert.match(s.body, /## Sources & guardrails/);
});

test("toShowMd round-trips to the same spec", () => {
  const { spec: s } = spec.parseShowMd(EXAMPLE);
  const again = spec.parseShowMd(spec.toShowMd(s));
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.spec, s);
  // and serializing is stable
  assert.equal(spec.toShowMd(again.spec), spec.toShowMd(s));
});

test("tricky strings survive a round trip", () => {
  const s = spec.emptyShowSpec();
  s.title = 'He said "hi", # not a comment: {really} [x]';
  s.tagline = "it's fine";
  s.hosts = [{ name: "A, B", voice: "" }];
  s.body = "## Voice & style\nCalm.";
  const back = spec.parseShowMd(spec.toShowMd(s));
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.spec, s);
});

test("validation catches bad input from either door", () => {
  const s = spec.emptyShowSpec();
  s.cadence = "hourly";
  s.narration_mode = "robot";
  s.schedule_time = "25:00";
  s.timezone = "Mars/Olympus";
  s.target_minutes = 0;
  s.image_url = "javascript:alert(1)";
  s.pronunciations = [{ term: "x", say_as: "", match: "regex" }];
  const errs = spec.validateShowSpec(s).join("\n");
  for (const want of ["title is required", "cadence", "narration_mode", "schedule_time", "timezone", "target_minutes", "image_url", "needs term and say_as", "match must be word or substring"]) {
    assert.ok(errs.includes(want), `missing error about ${want}:\n${errs}`);
  }
});

test("parse reports structural problems instead of guessing", () => {
  assert.match(spec.parseShowMd("no frontmatter").errors[0], /frontmatter/);
  const r = spec.parseShowMd('---\ntitle: "x"\nsurprise: 1\nexplicit: maybe\ntarget_minutes: "ten"\nhosts: "Iggy"\n---\nbody');
  const errs = r.errors.join("\n");
  assert.match(errs, /unknown field "surprise"/);
  assert.match(errs, /explicit must be true or false/);
  assert.match(errs, /target_minutes must be a number/);
  assert.match(errs, /hosts must be a list/);
  assert.match(spec.parseShowMd("---\ntitle: \"x\n---\n").errors.join(), /line 2/);
});

test("oversized show.md is rejected", () => {
  const big = "---\ntitle: x\n---\n" + "a".repeat(spec.MAX_SPEC_BYTES);
  assert.match(spec.parseShowMd(big).errors[0], /larger than/);
});

test("specToShowFields maps onto shows columns", () => {
  const { spec: s } = spec.parseShowMd(EXAMPLE);
  const f = spec.specToShowFields(s);
  assert.equal(f.description, s.tagline);
  assert.equal(f.voice_id, "iggy-v2");
  assert.deepEqual(f.hosts, [{ name: "Iggy", voice: "iggy-v2" }]);
  assert.equal(f.cadence, "daily");
  assert.ok(f.style_guide.startsWith("Host: Iggy\n\n## Voice & style"));
  assert.equal(spec.specToShowFields({ ...s, image_url: "", hosts: [] }).image_url, null);
});

// Golden test: the assembled generation prompt for the example show must not
// drift silently. If you change the template, parser or prompt on purpose, run
//   UPDATE_GOLDEN=1 npm test
// and commit the updated fixture.
test("example show prompt matches the golden snapshot", () => {
  const { spec: s } = spec.parseShowMd(EXAMPLE);
  const f = spec.specToShowFields(s);
  const { system, userText } = buildPrompt({
    showTitle: f.title,
    showDescription: f.description,
    targetMinutes: f.target_minutes,
    styleGuide: f.style_guide,
    briefings: [{ filename: "today.md", content_md: "SPY +0.4%. FOMC minutes at 2 PM." }],
  });
  const actual = `=== SYSTEM ===\n${system}\n\n=== USER ===\n${userText}\n`;
  const golden = "tests/fixtures/show-example.prompt.txt";
  if (process.env.UPDATE_GOLDEN) writeFileSync(golden, actual);
  assert.equal(actual, readFileSync(golden, "utf8"));
});

test("show files can't point artwork at outside sites", async () => {
  const { validateShowSpec, emptyShowSpec, TRUSTED_ART_HOSTS } = await import("../lib/show-spec.ts");
  const { TRUSTED_ART_HOSTS: fromImage } = await import("../lib/show-image.ts");
  assert.deepEqual(TRUSTED_ART_HOSTS, fromImage, "the two trusted-host lists match");
  const spec = { ...emptyShowSpec(), title: "T", timezone: "UTC" };
  const errs = (image_url) => validateShowSpec({ ...spec, image_url }).filter((e) => /image_url|Picture links/.test(e));
  assert.deepEqual(errs(""), []);
  assert.deepEqual(errs("https://www.needlesslyengineeredonlinenetwork.com/c.png"), []);
  assert.match(errs("https://cdn.example/c.png")[0], /Picture links are turned off/);
});
