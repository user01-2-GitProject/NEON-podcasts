const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const EPISODES = "gen_limit_episodes_per_day";
const COST = "gen_limit_cost_cents_per_day";

function recordingSql(respond = () => []) {
  const calls = [];
  const fn = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return respond(text, values);
  };
  fn.calls = calls;
  return fn;
}

// Loads app/api/limits/route.ts with its imports swapped for test doubles
// (the same approach as tests/rss.test.cjs).
function limitsRoute(sql, owner) {
  const source = readFileSync("app/api/limits/route.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const modules = {
    "next/server": require("next/server"),
    "@/lib/db": { sql },
    "@/lib/limits": require("../lib/limits.ts"),
    "@/lib/token-owner": { ownerId: async () => owner },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

const post = (body) =>
  new Request("https://app.test/api/limits", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("caps must be non-negative integers; 0 and positives are accepted", async () => {
  const { parseLimitsInput } = await import("../lib/limits.ts");
  assert.deepEqual(parseLimitsInput({ episodes_per_day: 0, cost_cents_per_day: 0 }), {
    limits: { episodesPerDay: 0, costCentsPerDay: 0 },
  });
  assert.deepEqual(parseLimitsInput({ episodes_per_day: 12, cost_cents_per_day: 250 }), {
    limits: { episodesPerDay: 12, costCentsPerDay: 250 },
  });
  const bad = [
    { episodes_per_day: -1, cost_cents_per_day: 5 },
    { episodes_per_day: 5, cost_cents_per_day: -0.5 },
    { episodes_per_day: 1.5, cost_cents_per_day: 5 },
    { episodes_per_day: NaN, cost_cents_per_day: 5 },
    { episodes_per_day: Infinity, cost_cents_per_day: 5 },
    { episodes_per_day: "5", cost_cents_per_day: 5 },
    { episodes_per_day: null, cost_cents_per_day: 5 },
    { episodes_per_day: 5 },
    { episodes_per_day: 5, cost_cents_per_day: 1_000_001 },
  ];
  for (const body of bad) assert.ok("error" in parseLimitsInput(body), JSON.stringify(body));
  assert.ok("error" in parseLimitsInput(null));
  assert.match(parseLimitsInput({ episodes_per_day: -1, cost_cents_per_day: 5 }).error, /episodes_per_day needs to be a whole number, 0 or more/);
});

test("saveLimits upserts exactly the two limit keys", async () => {
  const { saveLimits } = await import("../lib/limits.ts");
  const db = recordingSql();
  await saveLimits(db, { episodesPerDay: 7, costCentsPerDay: 300 });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /insert into app_settings \(key, value, updated_at\)/);
  assert.match(db.calls[0].text, /on conflict \(key\) do update set value = excluded\.value/);
  assert.deepEqual(db.calls[0].values, [EPISODES, "7", COST, "300"]);
});

test("GET /api/limits is owner-only and returns current caps with defaults", async () => {
  const denied = recordingSql();
  const forbidden = await limitsRoute(denied, null).GET();
  assert.equal(forbidden.status, 403);
  assert.equal(denied.calls.length, 0);

  const db = recordingSql(() => [{ key: EPISODES, value: "9" }]);
  const res = await limitsRoute(db, "owner-1").GET();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    episodes_per_day: 9,
    cost_cents_per_day: 100, // unset → default
    defaults: { episodes_per_day: 5, cost_cents_per_day: 100 },
  });
  assert.match(db.calls[0].text, /from app_settings/);
  assert.deepEqual(db.calls[0].values, [EPISODES, COST]);
});

test("POST /api/limits is owner-only, validates, then writes the limit keys", async () => {
  const denied = recordingSql();
  assert.equal((await limitsRoute(denied, null).POST(post({ episodes_per_day: 1, cost_cents_per_day: 1 }))).status, 403);
  assert.equal(denied.calls.length, 0);

  for (const body of [{ episodes_per_day: -3, cost_cents_per_day: 10 }, { episodes_per_day: 2.5, cost_cents_per_day: 10 }, "not json"]) {
    const db = recordingSql();
    const res = await limitsRoute(db, "owner-1").POST(post(body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(db.calls.length, 0, "nothing written on invalid input");
  }

  const stored = {};
  const db = recordingSql((text, values) => {
    if (text.includes("insert into app_settings")) {
      stored[values[0]] = values[1];
      stored[values[2]] = values[3];
      return [];
    }
    return Object.entries(stored).map(([key, value]) => ({ key, value }));
  });
  const res = await limitsRoute(db, "owner-1").POST(post({ episodes_per_day: 0, cost_cents_per_day: 250 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    episodes_per_day: 0,
    cost_cents_per_day: 250,
    defaults: { episodes_per_day: 5, cost_cents_per_day: 100 },
  });
  assert.deepEqual(stored, { [EPISODES]: "0", [COST]: "250" });
  assert.equal(db.calls.filter((c) => /insert into app_settings/.test(c.text)).length, 1);
  assert.equal(db.calls.some((c) => /delete/i.test(c.text)), false);
});
