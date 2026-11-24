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
