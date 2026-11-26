const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

test("regenerate route makes a run and writes back onto the same episode", () => {
  const src = read("app/api/episodes/[id]/regenerate/route.ts");
  assert.match(src, /export async function POST/);
  assert.match(src, /currentCaller\(/);
  assert.match(src, /checkGeneration\(/);
  assert.match(src, /insert into runs \(show_id, episode_id, status\)/);
  assert.match(src, /generateEpisode\(\s*episode\.show_id,\s*undefined,\s*undefined,\s*\{\s*episodeId: episode\.id, runId\s*\}/);
  assert.match(src, /We couldn't find that episode/);
});

test("generateEpisode has an id-preserving target path", () => {
  const src = read("lib/generate.ts");
  assert.match(src, /export interface RegenerateTarget/);
  assert.match(src, /let runId = target\?\.runId \?\? scheduledRun\?\.id/);
  assert.match(src, /update episodes set[\s\S]*where id = \$\{target\.episodeId\}/);
  assert.match(src, /if \(!target\) pendingAudioEpisodeId = episode\.id/);
  assert.match(src, /if \(target\) \{\s*\/\/ Leave the existing episode exactly as it was/);
});

test("owners get a two-tap regenerate button on every episode", () => {
  const src = read("components/EpisodesPanel.tsx");
  assert.match(src, /function RegenerateButton/);
  assert.match(src, /Regenerate with the latest setup/);
  assert.match(src, /Tap again to replace this episode/);
  assert.match(src, /owner \? <RegenerateButton episodeId=\{ep\.id\} \/>/);
  assert.match(src, /regenerate/);
});
