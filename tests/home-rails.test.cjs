const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const page = readFileSync("app/page.tsx", "utf8");
const route = readFileSync("app/api/browse/route.ts", "utf8");
const rail = readFileSync("components/ShowRail.tsx", "utf8");
const css = readFileSync("app/home-rails.css", "utf8");

// Every rail query runs as soon as getHomeRails is called, so return prepared
// rows in call order: your shows, official, fresh episodes, everything.
function queuedSql(queues) {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    const rows = queues[calls.length - 1] ?? [];
    return rows;
  };
  fn.calls = calls;
  return fn;
}

const show = (overrides = {}) => ({
  id: "s1",
  title: "District Daily Dose",
  description: "Sports",
  cadence: "daily",
  air_days: null,
  target_minutes: 20,
  is_official: true,
  image_url: null,
  episode_count: "3",
  latest_at: "2026-11-25T10:00:00Z",
  ...overrides,
});

test("all four rails come back from one call, scoped to active published shows", async () => {
  const { getHomeRails } = await import("../lib/home-rails.ts");
  const db = queuedSql([
    [show()],
    [show()],
    [{ id: "e1", title: "Ep 3", published_at: "2026-11-25T10:00:00Z", show_id: "s1", show_title: "District Daily Dose", is_official: true, image_url: null }],
    [show(), show({ id: "s2", title: "5:01 Diamond Hands" })],
  ]);
  const rails = await getHomeRails(db, "fan@example.com");
  assert.equal(db.calls.length, 4);
  assert.deepEqual(Object.keys(rails), ["your_shows", "official", "fresh_episodes", "everything"]);
  assert.match(db.calls[0].text, /subscriber_email = \?/);
  assert.deepEqual(db.calls[0].values, ["fan@example.com", 24]);
  assert.match(db.calls[1].text, /coalesce\(s\.is_official, false\)/);
  assert.match(db.calls[2].text, /e\.status = 'published'/);
  assert.match(db.calls[3].text, /s\.is_active/);
  for (const q of db.calls) assert.match(q.text, /latest_at|published_at/);
  assert.equal(rails.your_shows[0].episode_count, 3);
  assert.equal(rails.your_shows[0].is_official, true);
  assert.match(rails.your_shows[0].image_url, /^\/art\/s1\?v=/);
  assert.equal(rails.fresh_episodes[0].show_title, "District Daily Dose");
  assert.match(rails.fresh_episodes[0].image_url, /^\/art\/s1\?v=/);
  assert.equal(rails.everything.length, 2);
});

test("anonymous visitors skip the personal rail and caps are respected", async () => {
  const { getHomeRails } = await import("../lib/home-rails.ts");
  const db = queuedSql([[show()], [], [show()]]);
  const rails = await getHomeRails(db, null, { shows: 10_000, episodes: 999 });
  assert.equal(db.calls.length, 3);
  assert.deepEqual(rails.your_shows, []);
  assert.deepEqual(db.calls.map((c) => c.values.at(-1)), [48, 48, 48]);
});

test("the home page renders the four shelves in the intended order", () => {
  const titles = ["Your shows", "NEON Official", "Fresh episodes", "Browse everything"];
  let at = 0;
  for (const title of titles) {
    const next = page.indexOf(`title="${title}"`, at);
    assert.notEqual(next, -1, `missing rail: ${title}`);
    at = next;
  }
  assert.match(page, /<ShowRail[\s\S]*<ShowRail[\s\S]*<ShowRail[\s\S]*<ShowRail/);
  assert.match(page, /getHomeRails\(sql, email\)/);
  assert.match(page, /showCards\(rails\.everything\)/);
  assert.match(page, /episodeCards\(rails\.fresh_episodes\)/);
});

test("/api/browse can return the whole home payload in one request", () => {
  assert.match(route, /searchParams\.get\("rails"\) === "1"/);
  assert.match(route, /getHomeRails\(sql, email\)/);
  assert.match(route, /NextResponse\.json\(rails \? \{ shows, rails \} : \{ shows \}\)/);
});

test("rails scroll horizontally with snap points and show official badges", () => {
  assert.match(css, /\.rail-track \{[\s\S]*overflow-x: auto/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /scroll-snap-align: start/);
  assert.match(css, /var\(--font-display/);
  assert.match(rail, /<OfficialBadge size=\{20\}/);
  assert.match(rail, /role="list"/);
});
