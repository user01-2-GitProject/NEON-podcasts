const { test } = require("node:test");
const assert = require("node:assert/strict");

function fakeSql(rows = []) {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return rows;
  };
  fn.calls = calls;
  return fn;
}

test("publicAudioPath attaches the feed token to internal stream paths only", async () => {
  const { publicAudioPath } = await import("../lib/catalog.ts");
  assert.equal(publicAudioPath(null, "tok"), null);
  assert.equal(publicAudioPath("/api/episodes/abc/audio", "tok"), "/api/episodes/abc/audio?feed=tok");
  assert.equal(publicAudioPath("https://cdn.example.com/a.mp3", "tok"), "https://cdn.example.com/a.mp3");
});

test("browse is scoped to the caller for the following flag and only lists published shows", async () => {
  const { listBrowse } = await import("../lib/catalog.ts");
  const db = fakeSql([{ id: "s1", title: "T", description: null, rss_token: "r", published_count: "2", latest_at: null, following: true }]);
  const shows = await listBrowse(db, "a@x.com");
  assert.deepEqual(db.calls[0].values, ["a@x.com"]);
  assert.match(db.calls[0].text, /status = 'published'/);
  assert.equal(shows[0].published_count, 2);
  assert.equal(shows[0].following, true);
});

test("following feed binds the subscriber, caps the limit and rewrites audio URLs", async () => {
  const { listFollowingFeed } = await import("../lib/catalog.ts");
  const db = fakeSql([{ id: "e1", title: "Ep", published_at: null, audio_url: "/api/episodes/e1/audio", show_id: "s1", show_title: "S", rss_token: "r" }]);
  const eps = await listFollowingFeed(db, "a@x.com", 10_000);
  assert.deepEqual(db.calls[0].values, ["a@x.com", 200]);
  assert.match(db.calls[0].text, /subscriber_email/);
  assert.equal(eps[0].audio_url, "/api/episodes/e1/audio?feed=r");
});

test("show detail returns null for an unknown token and only published episodes otherwise", async () => {
  const { getShowByToken } = await import("../lib/catalog.ts");
  assert.equal(await getShowByToken(fakeSql([]), "nope"), null);
  const calls = [];
  const db = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return calls.length === 1
      ? [{ id: "s1", title: "S", description: null, rss_token: "r" }]
      : [{ id: "e1", title: "Ep", published_at: null, audio_url: "/api/episodes/e1/audio" }];
  };
  const detail = await getShowByToken(db, "r");
  assert.match(calls[1].text, /status = 'published'/);
  assert.equal(detail.episodes[0].audio_url, "/api/episodes/e1/audio?feed=r");
  assert.equal(detail.episodes[0].show_title, "S");
});

test("browse and show detail say whether a show is NEON-official", async () => {
  const { listBrowse, getShowByToken } = await import("../lib/catalog.ts");
  const db = fakeSql([{ id: "s1", title: "T", description: null, rss_token: "r", published_count: "1", latest_at: null, following: false, is_official: true }]);
  const shows = await listBrowse(db, "a@x.com");
  assert.match(db.calls[0].text, /is_official/);
  assert.equal(shows[0].is_official, true);
  let n = 0;
  const db2 = async () => (n++ === 0 ? [{ id: "s1", title: "S", description: null, rss_token: "r", is_official: null }] : []);
  const detail = await getShowByToken(db2, "r");
  assert.equal(detail.show.is_official, false);
});
