const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const compiled = ts.transpileModule(readFileSync("lib/claude.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObj = {};
new Function("require", "exports", compiled)((name) => {
  if (name === "@/lib/settings") return { resolveLlmConfig: async () => ({ provider: "anthropic" }) };
  if (name === "@anthropic-ai/sdk") return {};
  throw new Error(`unexpected require: ${name}`);
}, exportsObj);
const { buildPrompt } = exportsObj;

const baseArgs = {
  showTitle: "NEON Daily",
  showDescription: "Tech news",
  targetMinutes: 5,
  briefings: [{ filename: "notes.md", content_md: "The briefing." }],
};
const MARKER = "SHOW STYLE GUIDANCE";

test("a non-empty style guide is appended to the system prompt only", () => {
  const guide = "Be calm and curious. Avoid hype.";
  const { system, userText } = buildPrompt({ ...baseArgs, styleGuide: guide });
  assert.match(system, /SHOW STYLE GUIDANCE/);
  assert.ok(system.includes(guide));
  assert.ok(system.indexOf(MARKER) > system.indexOf("Rules for title:"));
  assert.doesNotMatch(userText, /SHOW STYLE GUIDANCE/);
});

test("empty or missing style guide adds no guidance section", () => {
  for (const styleGuide of ["", "   ", undefined]) {
    const { system } = buildPrompt({ ...baseArgs, styleGuide });
    assert.doesNotMatch(system, /SHOW STYLE GUIDANCE/);
  }
  const { system } = buildPrompt(baseArgs);
  assert.doesNotMatch(system, /SHOW STYLE GUIDANCE/);
});

test("an episode plan title is requested in the user text only", () => {
  const { system, userText } = buildPrompt({ ...baseArgs, episodeTitle: "Wednesday" });
  assert.match(userText, /EPISODE TITLE: Wednesday \(use this exact title\)/);
  assert.doesNotMatch(system, /EPISODE TITLE/);
  assert.doesNotMatch(buildPrompt(baseArgs).userText, /EPISODE TITLE/);
});

test("the owner's 'most important' answer leads the writer's direction", () => {
  const { mostImportant } = exportsObj;
  const guide = '## Voice & style\nCalm.\n\n## What matters most\nNever take a "side".\nBe fair.\n\n## Hard rules\n- No opinions.';
  assert.equal(mostImportant(guide), "Never take a 'side'. Be fair.");
  assert.equal(mostImportant("## Voice & style\nCalm."), null);
  assert.equal(mostImportant("## What matters most\n\n## Hard rules\n- x"), null);
  const { system } = buildPrompt({ ...baseArgs, styleGuide: guide });
  const at = system.indexOf("most important part of this podcast");
  assert.ok(at > 0 && at < system.indexOf("Rules for the script field:"), "said before the script rules");
  assert.ok(system.includes("Never take a 'side'. Be fair."));
  assert.match(system, /never overrides the rules about accuracy/);
  const plain = buildPrompt({ ...baseArgs, styleGuide: "Calm." }).system;
  assert.ok(!plain.includes("most important part"));
});
