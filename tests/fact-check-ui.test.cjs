const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const page = readFileSync("app/shows/[id]/page.tsx", "utf8");
const panel = readFileSync("components/EpisodesPanel.tsx", "utf8");

test("the show page selects fact checks and builds council prompts on the server", () => {
  assert.match(page, /select episode_id, script_qa, fact_check/);
  assert.match(page, /import \{ buildCouncilPrompt \} from "@\/lib\/fact-check"/);
  assert.match(page, /const councilPrompts/);
  assert.match(page, /quickdraw: promptFor\("quickdraw"\)/);
  assert.match(page, /scholar: promptFor\("scholar"\)/);
  // The clipboard gets the exact system + blank line + user shape.
  assert.ok(page.includes("${system}\\n\\n${user}"));
  assert.match(page, /councilPrompts=\{councilPrompts\}/);
  assert.match(page, /qaRuns=\{qaRuns\}/);
});

test("prompts require a briefing snapshot and only owners get the notes", () => {
  assert.match(page, /if \(owner\) \{/);
  assert.match(page, /!episode\?\.script\?\.trim\(\) \|\| !briefing\?\.trim\(\)/);
  assert.match(page, /if \(!run\.episode_id \|\| councilPrompts\[run\.episode_id\]\) continue;/);
  assert.match(page, /fact_check_council/);
  assert.match(panel, /const prompts = owner \? councilPrompts\[ep\.id\] : undefined;/);
  assert.match(panel, /const showFactCheck = owner && \(councilEnabled \|\| factCheckHasInfo\(factCheck\)\);/);
  assert.match(panel, /\{prompts \? \(/);
});

test("fact-check notes expand like QA notes and use the amber tokens", () => {
  assert.match(panel, /function FactCheckNotes/);
  assert.match(panel, /<details className="qa-notes fact-check-notes">/);
  assert.match(panel, /<summary className="tag qa" aria-label="Show fact-check notes">/);
  assert.match(panel, /var\(--warn\)/);
  assert.match(panel, /Council verdict/);
  assert.match(panel, /Awaiting council/);
  assert.match(panel, /Automatic check notes/);
  assert.match(panel, /of 3 models agreed/);
});

test("the grade, flags and added sources are shown in plain words", () => {
  assert.match(panel, /Grade \{grade\.score\}/);
  assert.match(panel, /Error types/);
  assert.match(panel, /Caught by/);
  assert.match(panel, /Council flags/);
  assert.match(panel, /Lead said/);
  assert.match(panel, /Added sources/);
  assert.match(panel, /Lead notes/);
  assert.match(panel, /quickdraw: "Quickdraw"/);
  assert.match(panel, /scholar: "Scholar"/);
  assert.match(panel, /lead: "Lead"/);
});

test("owner-only clipboard buttons use a transient Copied label", () => {
  assert.match(panel, /function CopyCouncilPromptButton/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /Copy Quickdraw prompt/);
  assert.match(panel, /Copy Scholar prompt/);
  assert.match(panel, /copied \? "Copied" : label/);
  assert.match(panel, /setCopied\(false\), 1500/);
});
