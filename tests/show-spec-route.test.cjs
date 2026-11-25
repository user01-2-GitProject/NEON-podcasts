const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const specLib = require("../lib/show-spec.ts");
const EXAMPLE = readFileSync("templates/show.example.md", "utf8");

function recordingSql() {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [{ id: "show-1", title: values[1] }];
  };
  fn.calls = calls;
  return fn;
}

function route(sql) {
  const compiled = ts.transpileModule(readFileSync("app/api/shows/spec/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const modules = {
    "next/server": require("next/server"),
    "@/lib/db": { sql },
    "@/lib/me": { currentUserId: async () => "user-1" },
    "@/lib/show-spec": specLib,
    "@/lib/cadence": require("../lib/cadence.ts"),
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

const post = (body) =>
  new Request("https://app.test/api/shows/spec", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("file door and form door write identical values", async () => {
  const fileDb = recordingSql();
  const fileRes = await route(fileDb).POST(post({ markdown: EXAMPLE }));
  assert.equal(fileRes.status, 201);

  const parsed = specLib.parseShowMd(EXAMPLE).spec;
  const formDb = recordingSql();
  const formRes = await route(formDb).POST(post({ spec: JSON.parse(JSON.stringify(parsed)) }));
  assert.equal(formRes.status, 201);

  assert.equal(fileDb.calls.length, 1);
  assert.deepEqual(formDb.calls[0].values, fileDb.calls[0].values);
  const text = fileDb.calls[0].text;
  assert.match(text, /insert into shows/);
  assert.match(text, /insert into show_pronunciations/);
  const v = fileDb.calls[0].values;
  assert.equal(v[0], "user-1");
  assert.equal(v[1], "5:01 Diamond Hands");
  assert.ok(v[3].startsWith("Host: Iggy\n\n## Voice & style"), "style guide built from the body");
  assert.deepEqual(v.slice(-3), [["FOMC", "0DTE"], ["F O M C", "zero D T E"], ["word", "word"]]);
});

test("invalid specs are rejected with every problem and nothing is written", async () => {
  for (const body of [
    { markdown: "no frontmatter" },
    { spec: { title: "", cadence: "hourly", target_minutes: "5" } },
    { spec: { title: "x", image_url: "javascript:alert(1)" } },
    { spec: { title: "x", pronunciations: [{ term: "a", say_as: "b", match: "regex" }] } },
    {},
    "not json",
  ]) {
    const db = recordingSql();
    const res = await route(db).POST(post(body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(db.calls.length, 0);
  }
  const res = await route(recordingSql()).POST(post({ spec: { title: "", cadence: "hourly" } }));
  const data = await res.json();
  assert.ok(data.errors.length >= 2);
});

test("oversized bodies are refused before parsing", async () => {
  const db = recordingSql();
  const res = await route(db).POST(post({ markdown: "x".repeat(specLib.MAX_SPEC_BYTES * 2 + 1) }));
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
});

test("coerceShowSpec forces types and never trusts shapes", () => {
  const s = specLib.coerceShowSpec({
    title: 5,
    hosts: "Iggy",
    pronunciations: [null, { term: 1 }],
    tags: ["a", 2, " b "],
    explicit: "yes",
    target_minutes: "10",
  });
  assert.equal(s.title, "");
  assert.deepEqual(s.hosts, []);
  assert.deepEqual(s.pronunciations, [
    { term: "", say_as: "", match: "word" },
    { term: "", say_as: "", match: "word" },
  ]);
  assert.deepEqual(s.tags, ["a", "b"]);
  assert.equal(s.explicit, false);
  assert.ok(Number.isNaN(s.target_minutes));
  assert.ok(specLib.validateShowSpec(s).some((e) => e.includes("target_minutes")));
  assert.deepEqual(specLib.coerceShowSpec(null), specLib.emptyShowSpec());
});
