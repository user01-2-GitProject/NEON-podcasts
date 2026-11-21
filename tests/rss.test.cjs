const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const source = readFileSync("app/feed/[token]/route.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const show = { id: "show-1", title: 'NEON & <Friends>', description: 'News > noise & "more"' };
const episode = {
  id: "episode-1", title: 'One <two> & three', show_notes: 'Notes & "quotes"',
  audio_url: "/api/episodes/episode-1/audio", byte_size: 1234,
  content_type: "audio/mpeg", duration_seconds: 90, published_at: "2026-11-21T12:00:00.000Z",
};
const olderEpisode = { ...episode, id: "episode-2", audio_url: "/api/episodes/episode-2/audio", byte_size: 4321, content_type: "", published_at: "2026-11-20T12:00:00.000Z" };

function route(showRows = [show], episodeRows = [episode, olderEpisode]) {
  const exports = {};
  const sql = (strings) => {
    const query = strings.join("?");
    if (query.includes("from shows")) return showRows;
    assert.match(query, /e\.status = 'published'/);
    assert.match(query, /order by e\.published_at desc/);
    return episodeRows;
  };
  new Function("require", "exports", compiled)((name) => {
    assert.equal(name, "@/lib/db");
    return { sql };
  }, exports);
  return exports.GET;
}

function assertWellFormed(xml) {
  const stack = [];
  const tags = xml.match(/<[^>]+>/g) || [];
  for (const tag of tags) {
    if (tag.startsWith("<?")) continue;
    const name = tag.match(/^<\/?([\w:]+)/)?.[1];
    assert.ok(name, `Invalid tag: ${tag}`);
    if (tag.startsWith("</")) assert.equal(stack.pop(), name);
    else if (!tag.endsWith("/>")) stack.push(name);
  }
  assert.deepEqual(stack, []);
  assert.doesNotMatch(xml.replace(/&(?:amp|lt|gt|quot|apos);/g, ""), /&/);
}

test("RSS response is well-formed with complete enclosures, RFC-822 dates, and escaped text", async () => {
  const response = await route()(new Request("https://podcasts.example/feed/secret"), { params: Promise.resolve({ token: "secret" }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/rss\+xml/);
  const body = await response.text();
  assertWellFormed(body);
  assert.match(body, /NEON &amp; &lt;Friends&gt;/);
  assert.match(body, /Notes &amp; &quot;quotes&quot;/);
  assert.match(body, /<title>NEON &amp; &lt;Friends&gt;<\/title>/);
  assert.match(body, /<description>News &gt; noise &amp; &quot;more&quot;<\/description>/);
  assert.equal((body.match(/<item>/g) || []).length, 2);
  const date = body.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
  assert.match(date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
  assert.equal(new Date(date).toISOString(), episode.published_at);
  const enclosures = [...body.matchAll(/<enclosure\s+url="([^"]+)"\s+length="([^"]+)"\s+type="([^"]+)"\s*\/>/g)];
  assert.equal(enclosures.length, 2);
  for (const [index, enclosure] of enclosures.entries()) {
    const expected = [episode, olderEpisode][index];
    assert.equal(enclosure[1], `https://podcasts.example/api/episodes/${expected.id}/audio?feed=secret`);
    assert.equal(enclosure[2], String(expected.byte_size));
    assert.equal(enclosure[3], "audio/mpeg");
  }
});

test("unknown feed token returns 404", async () => {
  const response = await route([])(new Request("https://podcasts.example/feed/missing"), { params: Promise.resolve({ token: "missing" }) });
  assert.equal(response.status, 404);
});
