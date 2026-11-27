const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const specLib = require("../lib/show-spec.ts");
const EXAMPLE = readFileSync("templates/show.example.md", "utf8");
const parsed = specLib.parseShowMd(EXAMPLE).spec;

function storedShow(spec) {
  const f = specLib.specToShowFields(spec);
  return { id: "show-1", ...f };
}
const storedProns = (spec) => spec.pronunciations.map((p) => ({ term: p.term, say_as: p.say_as, match_mode: p.match }));

function route(sql) {
  const compiled = ts.transpileModule(readFileSync("app/api/shows/[id]/spec/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const modules = { "next/server": require("next/server"), "@/lib/db": { sql }, "@/lib/show-spec": specLib, "@/lib/cadence": require("../lib/cadence.ts") };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

function fakeSql(respond) {
  const calls = [];
  const fn = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return respond(text, values);
  };
  fn.calls = calls;
  return fn;
}

const ctx = { params: Promise.resolve({ id: "show-1" }) };
const put = (body) =>
  new Request("https://app.test/api/shows/show-1/spec", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("showToSpec inverts specToShowFields for stored fields", () => {
  const back = specLib.showToSpec(storedShow(parsed), storedProns(parsed));
  const expected = { ...parsed, category: "", language: "en-us", explicit: false, tags: [] };
  assert.deepEqual(back, expected);
});

test("two hosts and a missing host line both survive export", () => {
  const two = { ...parsed, hosts: [{ name: "Iggy", voice: "v1" }, { name: "Matt", voice: "" }] };
  assert.deepEqual(specLib.showToSpec(storedShow(two), []).hosts, two.hosts);
  const none = specLib.showToSpec(
    { ...storedShow(parsed), style_guide: "## Voice & style\nCalm.", voice_id: null, hosts: [] },
    [],
  );
  assert.deepEqual(none.hosts, []);
  assert.equal(none.body, "## Voice & style\nCalm.");
});

test("GET exports a show.md download that re-imports cleanly", async () => {
  const db = fakeSql((text) => (text.includes("from shows") ? [storedShow(parsed)] : storedProns(parsed)));
  const res = await route(db).GET(new Request("https://app.test/api/shows/show-1/spec"), ctx);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="5-01-diamond-hands\.md"/);
  const md = await res.text();
  const again = specLib.parseShowMd(md);
  assert.deepEqual(again.errors, []);
  assert.equal(again.spec.body, parsed.body);

  const json = await route(db).GET(new Request("https://app.test/api/shows/show-1/spec?format=json"), ctx);
  assert.equal((await json.json()).spec.title, "5:01 Diamond Hands");
});

test("GET is 404 for an unknown show", async () => {
  const res = await route(fakeSql(() => [])).GET(new Request("https://app.test/x"), ctx);
  assert.equal(res.status, 404);
});

test("PUT updates the show and swaps pronunciations in one statement", async () => {
  const db = fakeSql(() => [{ id: "show-1" }]);
  const res = await route(db).PUT(put({ markdown: EXAMPLE }), ctx);
  assert.equal(res.status, 200);
  assert.equal(db.calls.length, 1);
  const { text, values } = db.calls[0];
  assert.match(text, /update shows set/);
  assert.match(text, /delete from show_pronunciations where show_id in \(select id from s\)/);
  assert.match(text, /insert into show_pronunciations/);
  assert.ok(values.includes("show-1"));
  assert.deepEqual(values.slice(-3), [["FOMC", "0DTE"], ["F O M C", "zero D T E"], ["word", "word"]]);
});

test("PUT via the form door writes the same values as the file door", async () => {
  const a = fakeSql(() => [{ id: "show-1" }]);
  const b = fakeSql(() => [{ id: "show-1" }]);
  await route(a).PUT(put({ markdown: EXAMPLE }), ctx);
  await route(b).PUT(put({ spec: JSON.parse(JSON.stringify(parsed)) }), ctx);
  assert.deepEqual(b.calls[0].values, a.calls[0].values);
});

test("PUT rejects bad input without writing, and 404s an unknown show", async () => {
  for (const body of [{ markdown: "nope" }, { spec: { title: "" } }, {}, "not json"]) {
    const db = fakeSql(() => []);
    const res = await route(db).PUT(put(body), ctx);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(db.calls.length, 0);
  }
  const big = await route(fakeSql(() => [])).PUT(put({ markdown: "x".repeat(specLib.MAX_SPEC_BYTES * 2) }), ctx);
  assert.equal(big.status, 413);
  const missing = await route(fakeSql(() => [])).PUT(put({ markdown: EXAMPLE }), ctx);
  assert.equal(missing.status, 404);
});
