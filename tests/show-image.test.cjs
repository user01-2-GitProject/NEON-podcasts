const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const SHOW_ID = "11111111-1111-4111-8111-111111111111";
const ART = "https://cdn.example/art.png?size=3000&v=2";

// Loads a route module from source with its imports swapped for test doubles,
// the same way tests/rss.test.cjs exercises the feed route.
function loadRoute(file, modules) {
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

function recordingSql(respond) {
  const calls = [];
  const fn = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return respond(text, values);
  };
  fn.calls = calls;
  return fn;
}

const existing = {
  id: SHOW_ID, title: "Show", description: "", style_guide: "", voice_id: null, cadence: "manual",
  schedule_time: "09:00", timezone: "UTC", target_minutes: 5, is_active: true, image_url: null,
};

function patchRoute(sql) {
  return loadRoute("app/api/shows/[id]/route.ts", {
    "next/server": require("next/server"),
    "@/lib/db": { sql },
    "@/lib/schedule": require("../lib/schedule.ts"),
    "@/lib/cadence": require("../lib/cadence.ts"),
    "@/lib/show-image": require("../lib/show-image.ts"),
    "@/lib/storage": { getStorage: () => ({ delete: async () => {} }) },
  }).PATCH;
}

async function patch(sql, body) {
  const req = new Request(`https://app.test/api/shows/${SHOW_ID}`, { method: "PATCH", body: JSON.stringify(body) });
  return patchRoute(sql)(req, { params: Promise.resolve({ id: SHOW_ID }) });
}

test("image URLs must be http(s); empty or null clears", async () => {
  const { parseImageUrl } = await import("../lib/show-image.ts");
  assert.deepEqual(parseImageUrl(` ${ART} `), { value: ART });
  assert.deepEqual(parseImageUrl("http://example.com/a.jpg"), { value: "http://example.com/a.jpg" });
  assert.deepEqual(parseImageUrl(""), { value: null });
  assert.deepEqual(parseImageUrl(null), { value: null });
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x/a.png", "/podcast-cover.png", "not a url", 42]) {
    assert.ok("error" in parseImageUrl(bad), String(bad));
  }
  assert.ok("error" in parseImageUrl(`https://x.test/${"a".repeat(2048)}`));
});

test("PATCH stores image_url for the show and returns it", async () => {
  let stored = null;
  const sql = recordingSql((text, values) => {
    if (text.startsWith("update shows set image_url")) stored = values[0];
    if (text.includes("select * from shows")) return [existing];
    return [{ ...existing, image_url: stored }];
  });
  const res = await patch(sql, { image_url: ART });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).show.image_url, ART);
  const write = sql.calls.find((c) => c.text.startsWith("update shows set image_url"));
  assert.deepEqual(write.values, [ART, SHOW_ID]);

  const cleared = recordingSql((text) => (text.includes("select * from shows") ? [existing] : [existing]));
  await patch(cleared, { image_url: "" });
  assert.deepEqual(cleared.calls.find((c) => c.text.startsWith("update shows set image_url")).values, [null, SHOW_ID]);
});

test("PATCH rejects a non-http(s) image and leaves image_url alone when it isn't sent", async () => {
  const sql = recordingSql((text) => (text.includes("select * from shows") ? [existing] : [existing]));
  const bad = await patch(sql, { image_url: "javascript:alert(1)" });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /http\(s\) URL/);
  assert.equal(sql.calls.some((c) => /image_url/.test(c.text)), false);

  // other edits never touch image_url, so they keep working before migration 009
  const other = recordingSql((text) => (text.includes("select * from shows") ? [existing] : [existing]));
  assert.equal((await patch(other, { title: "Renamed" })).status, 200);
  assert.equal(other.calls.some((c) => /image_url/.test(c.text)), false);
});

test("browse, show detail and the following feed expose the show image", async () => {
  const { listBrowse, getShowByToken, listFollowingFeed } = await import("../lib/catalog.ts");

  const browse = recordingSql(() => [
    { id: "s1", title: "T", description: null, rss_token: "r", published_count: "1", latest_at: null, following: false, image_url: ART },
  ]);
  const shows = await listBrowse(browse, "a@x.com");
  assert.equal(shows[0].image_url, ART);
  assert.match(browse.calls[0].text, /to_jsonb\(x\) ->> 'image_url'/);

  const detail = recordingSql((text) =>
    text.includes("from shows")
      ? [{ id: "s1", title: "S", description: null, rss_token: "r", image_url: ART }]
      : [{ id: "e1", title: "Ep", published_at: null, audio_url: null }],
  );
  const show = await getShowByToken(detail, "r");
  assert.equal(show.show.image_url, ART);
  assert.equal(show.episodes[0].show_image_url, ART);

  const feed = recordingSql(() => [
    { id: "e1", title: "Ep", published_at: null, audio_url: null, show_id: "s1", show_title: "S", rss_token: "r", show_image_url: ART },
  ]);
  assert.equal((await listFollowingFeed(feed, "a@x.com"))[0].show_image_url, ART);
  assert.match(feed.calls[0].text, /'image_url' as show_image_url/);
});

function feedRoute(showRow) {
  return loadRoute("app/feed/[token]/route.ts", {
    "@/lib/db": { sql: (strings) => (strings.join("?").includes("from shows") ? [showRow] : []) },
    "@/lib/cover": require("../lib/cover.ts"),
  }).GET;
}

async function feedBody(showRow) {
  const res = await feedRoute(showRow)(new Request("https://podcasts.example/feed/tok"), { params: Promise.resolve({ token: "tok" }) });
  return res.text();
}

test("RSS uses the show image as <itunes:image>, falling back to its generated cover", async () => {
  const base = { id: SHOW_ID, title: "Show", description: "d" };
  assert.match(
    await feedBody({ ...base, image_url: ART }),
    /<itunes:image href="https:\/\/cdn\.example\/art\.png\?size=3000&amp;v=2" \/>/,
  );
  const generated = new RegExp(`<itunes:image href="https://podcasts\\.example/art/${SHOW_ID}\\?v=[a-z0-9]+" />`);
  assert.match(await feedBody({ ...base, image_url: null }), generated);
  // before migration 009 the column is absent entirely
  assert.match(await feedBody(base), generated);
  assert.match(await feedBody({ ...base, image_url: "javascript:alert(1)" }), generated);
});
