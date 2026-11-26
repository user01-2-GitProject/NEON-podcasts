const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const page = readFileSync("app/episodes/[id]/edit/page.tsx", "utf8");
const route = readFileSync("app/api/episodes/[id]/splice/route.ts", "utf8");
const panel = readFileSync("components/EpisodesPanel.tsx", "utf8");
const middleware = readFileSync("middleware.ts", "utf8");
const readme = readFileSync("README.md", "utf8");

test("the editor is owner-gated and splits the transcript into editable sentences", () => {
  assert.match(page, /role === "owner"/);
  assert.match(page, /redirect\(`\/shows\/\$\{episode\.show_id\}`\)/);
  assert.match(page, /splitIntoSentences\(episode\.script/);
  assert.match(page, /sentences\.map\(/);
  assert.match(page, /name="sentenceIndex"/);
  assert.match(page, /name="text"/);
  assert.match(page, /Fix this sentence/);
  assert.match(page, /<audio controls/);
});

test("the editor and the API both flag the estimated-timing stub", () => {
  assert.match(page, /Accuracy note:/);
  assert.match(page, /does not return per-sentence timestamps/);
  assert.match(page, /query\.stubbed === "1"/);
  assert.match(route, /stubbed: true/);
  assert.match(route, /timingSource: "word-count"/);
  assert.match(route, /DEFAULT_CROSSFADE_SECONDS/);
});

test("owners can reach the editor from the episode list", () => {
  assert.match(panel, /href=\{`\/episodes\/\$\{ep\.id\}\/edit`\}/);
  assert.match(panel, /owner && ep\.audio_url && ep\.script/);
  assert.match(page, /Back to \{episode\.show_title\}/);
});

test("the splice endpoint stays behind the existing non-GET owner gate", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(middleware, /pathname\.startsWith\("\/api\/"\) && !\["GET", "HEAD", "OPTIONS"\]/);
});

test("the ffmpeg dependency and accuracy limit are documented", () => {
  assert.match(readme, /Fix one sentence in an episode/);
  assert.match(readme, /ffmpeg/);
  assert.match(readme, /ffprobe/);
  assert.match(readme, /stubbed/);
  assert.match(readme, /fraction of a second/);
});
