const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ep = require("../lib/episode-spec.ts");

const plan = (fm, body = "## Segment 1\nThe tape.") => `---\n${fm}\n---\n\n${body}`;

test("the example episode template parses as a not-ready plan with no date", () => {
  const p = ep.parseEpisodeMd(readFileSync("templates/episode.example.md", "utf8"));
  assert.equal(p.status, "not_ready");
  assert.equal(p.air_date, null); // still the MM-DD-YYYY placeholder
  assert.deepEqual(p.hosts, ["Iggy"]);
  assert.match(p.body, /^==🟢 NEON PLUG==/);
});

test("status and air date follow the vault's conventions", () => {
  assert.equal(ep.parseStatus("🟢 Ready"), "ready");
  assert.equal(ep.parseStatus("🟡 Not Ready"), "not_ready");
  assert.equal(ep.parseStatus("🔴 Completed - DO NOT USE"), "completed");
  assert.equal(ep.parseStatus(""), "ready");
  assert.equal(ep.parseAirDate("11-26-2026"), "2026-11-26");
  assert.equal(ep.parseAirDate("2026-11-26"), "2026-11-26");
  assert.equal(ep.parseAirDate("02-30-2026"), null);
  assert.equal(ep.parseAirDate("MM-DD-YYYY"), null);
});

test("plain briefings and show.md files are not episode plans", () => {
  assert.equal(ep.parseEpisodeMd("# Notes\nNo frontmatter."), null);
  assert.equal(ep.parseEpisodeMd(readFileSync("templates/show.example.md", "utf8")), null);
  assert.equal(ep.parseEpisodeMd(plan('title: "Just a doc"')), null);
});

test("selectBriefings uses the earliest due ready plan and holds the rest", () => {
  const docs = [
    { id: "b1", filename: "today.md", content_md: "SPY up." },
    { id: "p-future", filename: "fri.md", content_md: plan('title: "Friday"\nstatus: "🟢 Ready"\nair_date: "11-27-2026"') },
    { id: "p-due", filename: "wed.md", content_md: plan('title: "Wednesday"\nepisode: "12"\nstatus: "🟢 Ready"\nair_date: "11-25-2026"\nnotes: "keep it tight"\nhosts:\n  - { name: "Iggy", voice: "v2" }') },
    { id: "p-undated", filename: "any.md", content_md: plan('title: "Whenever"\nstatus: "ready"') },
    { id: "p-draft", filename: "draft.md", content_md: plan('title: "Draft"\nstatus: "🟡 Not Ready"') },
    { id: "p-done", filename: "done.md", content_md: plan('title: "Old"\nstatus: "🔴 Completed - DO NOT USE"') },
  ];
  const sel = ep.selectBriefings(docs, "2026-11-25");
  assert.equal(sel.plan.briefingId, "p-due");
  assert.equal(sel.plan.title, "Wednesday");
  assert.deepEqual(sel.skipped.map((d) => d.id).sort(), ["p-done", "p-draft", "p-future", "p-undated"]);
  assert.equal(sel.docs.length, 2);
  assert.deepEqual(sel.docs[0], { filename: "today.md", content_md: "SPY up." });
  assert.equal(sel.docs[1].filename, "wed.md (episode plan)");
  assert.equal(sel.docs[1].content_md, "Episode: 12\nHosts: Iggy\nProducer notes: keep it tight\n\n## Segment 1\nThe tape.");
  assert.doesNotMatch(sel.docs[1].content_md, /^---/);
});

test("with no plans, briefings pass through untouched", () => {
  const docs = [{ id: "b1", filename: "a.md", content_md: "A" }];
  const sel = ep.selectBriefings(docs, "2026-11-25");
  assert.equal(sel.plan, null);
  assert.deepEqual(sel.docs, [{ filename: "a.md", content_md: "A" }]);
});

test("todayIn respects the show's timezone", () => {
  const now = new Date("2026-11-26T03:00:00Z");
  assert.equal(ep.todayIn("America/Detroit", now), "2026-11-25");
  assert.equal(ep.todayIn("UTC", now), "2026-11-26");
  assert.equal(ep.todayIn("Not/AZone", now), "2026-11-26");
});
