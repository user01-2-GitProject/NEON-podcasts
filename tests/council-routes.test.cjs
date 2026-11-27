const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const loadFactCheck = () => import("../lib/fact-check.ts");
const loadCouncil = () => import("../lib/council.ts");
const personas = require("../lib/fact-check-personas.json");

// Routes are transpiled and their imports injected — the same pattern as the
// other route tests in this repo. No Next server, no database, no network.
function loadRoute(file, modules) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

function recordingSql(responder = () => []) {
  const calls = [];
  const fn = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return responder(text, values, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const caller = {
  userId: "user-1",
  email: "owner@example.com",
  role: "owner",
  ownerApproved: true,
  tokenId: "token-1",
  tokenLabel: "Rig",
};

const episode = {
  episode_id: "ep-1",
  show_id: "show-1",
  title: "Episode one",
  status: "draft",
  audio_url: "/audio/ep-1.mp3",
  fact_check_council: true,
  run_id: "run-1",
  fact_check: { notes: [{ kind: "wrong", message: "Layer one", excerpt: "x" }], model: "free", checked_at: "2026-01-01T00:00:00.000Z" },
};

const passBody = () => ({
  members: [
    { persona: "quickdraw", model: "codex", notes: [] },
    { persona: "scholar", model: "muse", notes: [] },
  ],
  upheld: [],
  dismissed: [],
  verdict: "pass",
  tags: ["space"],
  added_sources: [],
});

const failBody = () => ({
  ...passBody(),
  verdict: "fail",
  upheld: [{ persona: "quickdraw", kind: "wrong", message: "Wrong year", excerpt: "in 1999" }],
});

const post = (body) =>
  new Request("https://app.test/api/episodes/ep-1/fact-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const patchGrade = (body) => new Request("https://app.test/api/episodes/ep-1/fact-check", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

const params = () => ({ params: Promise.resolve({ id: "ep-1" }) });

// ---------------------------------------------------------------------------
// DB helpers (Task 4) with a fake sql client.
// ---------------------------------------------------------------------------

test("pending rows are scoped, filtered for no council verdict, oldest first, and carry prompts", async () => {
  const { listPendingCouncil } = await loadCouncil();
  const row = {
    episode_id: "ep-1",
    run_id: "run-1",
    show_id: "show-1",
    title: "Episode one",
    script: "A story about NASA today",
    briefing_snapshot: "SOURCE DOC",
    briefing_docs: "ACTIVE SHOW BRIEFING",
  };
  const db = recordingSql(() => [row]);
  const items = await listPendingCouncil(db, caller.userId, 10);

  assert.equal(items.length, 1);
  assert.deepEqual(
    {
      episode_id: items[0].episode_id,
      run_id: items[0].run_id,
      show_id: items[0].show_id,
      title: items[0].title,
      script: items[0].script,
      briefing_snapshot: items[0].briefing_snapshot,
      briefing_docs: items[0].briefing_docs,
    },
    row,
  );
  assert.ok(items[0].prompts.quickdraw.system.startsWith(`${personas.quickdraw}\n\n`));
  assert.ok(items[0].prompts.scholar.system.startsWith(`${personas.scholar}\n\n`));
  assert.ok(items[0].prompts.quickdraw.user.includes("A story about NASA today"));
  assert.ok(items[0].prompts.scholar.user.includes("SOURCE DOC"));
  assert.ok(items[0].prompts.quickdraw.user.includes("ACTIVE SHOW BRIEFING"));
  assert.ok(items[0].prompts.scholar.user.includes("ACTIVE SHOW BRIEFING"));
  assert.ok(db.calls[0].text.includes("show_briefings"));
  assert.notEqual(items[0].prompts.quickdraw.system, items[0].prompts.scholar.system);
  assert.ok(items[0].prompts.qwen, "Q5 reserved voter always gets a prompt");
  assert.equal(typeof items[0].prompts.qwen.system, "string");
  assert.ok(items[0].prompts.qwen.user.includes("A story about NASA today"));
  assert.ok(items[0].prompts.qwen.user.includes("SOURCE DOC"));

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /fact_check_council = true/);
  assert.match(db.calls[0].text, /fact_check->'council'->>'verdict' is null/);
  assert.match(db.calls[0].text, /distinct on \(r\.episode_id\)/);
  assert.match(db.calls[0].text, /order by l\.started_at asc/);
  assert.match(db.calls[0].text, /limit \?/);
  assert.deepEqual(db.calls[0].values, [caller.userId, 10]);
});

test("episode lookup is ownership-scoped and loads the latest run", async () => {
  const { findCouncilEpisode } = await loadCouncil();
  const db = recordingSql((text, values) => (values[0] === "ep-1" && values[1] === caller.userId ? [episode] : []));

  assert.deepEqual(await findCouncilEpisode(db, "ep-1", caller.userId), episode);
  assert.equal(await findCouncilEpisode(db, "ep-1", "someone-else"), null);
  assert.equal(await findCouncilEpisode(db, "missing", caller.userId), null);
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].text, /s\.user_id = \?/);
  assert.match(db.calls[0].text, /order by started_at desc, id desc/);
  assert.deepEqual(db.calls[0].values, ["ep-1", caller.userId]);
});

test("persisting a merged result writes the whole jsonb value with layer-1 notes intact", async () => {
  const { saveCouncilFactCheck, parseStoredFactCheck } = await loadCouncil();
  const { mergeCouncilResult, validateCouncilSubmission } = await loadFactCheck();
  const checked = validateCouncilSubmission(failBody());
  assert.equal(checked.ok, true, checked.error);
  const merged = mergeCouncilResult(parseStoredFactCheck(episode.fact_check), checked.value, new Date("2026-02-02T00:00:00.000Z"));
  const db = recordingSql();

  await saveCouncilFactCheck(db, episode.run_id, episode.show_id, merged);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /update runs set fact_check = \?::jsonb/);
  assert.deepEqual(db.calls[0].values.slice(1), [episode.run_id, episode.show_id]);
  const stored = JSON.parse(db.calls[0].values[0]);
  assert.deepEqual(stored.notes, episode.fact_check.notes, "automatic notes are not overwritten");
  assert.equal(stored.verdict, "fail");
  assert.equal(stored.agent_notes.length, 1);
  assert.equal(stored.grade.score, "D");
});

test("stored fact_check accepts jsonb objects, JSON strings and junk", async () => {
  const { parseStoredFactCheck } = await loadCouncil();
  assert.deepEqual(parseStoredFactCheck(episode.fact_check), episode.fact_check);
  assert.deepEqual(parseStoredFactCheck(JSON.stringify(episode.fact_check)), episode.fact_check);
  for (const junk of [null, undefined, "", "{bad json}", 42, ["notes"]]) {
    assert.equal(parseStoredFactCheck(junk), null);
  }
});

test("publishIfReady fires only for an opted-in draft with audio on a pass", async () => {
  const { publishIfReady } = await loadCouncil();
  const base = {
    episodeId: episode.episode_id,
    showId: episode.show_id,
    optedIn: true,
    verdict: "pass",
    status: episode.status,
    audioUrl: episode.audio_url,
  };
  for (const [change, shouldPublish] of [
    [{}, true],
    [{ verdict: "fail" }, false],
    [{ status: "published" }, false],
    [{ audioUrl: null }, false],
    [{ optedIn: false }, false],
  ]) {
    const db = recordingSql(() => [{ id: episode.episode_id }]);
    const published = await publishIfReady(db, { ...base, ...change });
    assert.equal(published, shouldPublish, JSON.stringify(change));
    assert.equal(db.calls.length, shouldPublish ? 1 : 0, JSON.stringify(change));
    if (shouldPublish) {
      assert.match(db.calls[0].text, /update episodes/);
      assert.match(db.calls[0].text, /status = 'published'/);
      assert.deepEqual(db.calls[0].values, [episode.episode_id, episode.show_id]);
    }
  }
});

// ---------------------------------------------------------------------------
// Route handlers (Task 4) with injected auth/db/council modules.
// ---------------------------------------------------------------------------

function pendingRoute(activeCaller, items = []) {
  const seen = {};
  const route = loadRoute("app/api/council/pending/route.ts", {
    "next/server": require("next/server"),
    "@/auth": { auth: async () => null },
    "@/lib/current-user": {
      currentCaller: async (opts) => {
        seen.callerOpts = opts;
        return activeCaller;
      },
    },
    "@/lib/db": { sql: {} },
    "@/lib/council": {
      listPendingCouncil: async (sql, userId) => {
        seen.listArgs = [sql, userId];
        return items;
      },
    },
  });
  return { route, seen };
}

test("GET /api/council/pending returns 401 without a caller", async () => {
  const { route, seen } = pendingRoute(null);
  const res = await route.GET(new Request("https://app.test/api/council/pending"));
  assert.equal(res.status, 401);
  assert.equal(seen.listArgs, undefined);
});

test("GET /api/council/pending returns only the caller's prepared items", async () => {
  const items = [{ episode_id: "ep-1", run_id: "run-1", prompts: { quickdraw: {}, scholar: {} } }];
  const { route, seen } = pendingRoute(caller, items);
  const res = await route.GET(
    new Request("https://app.test/api/council/pending", {
      headers: { authorization: "Bearer npt_token" },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items });
  assert.equal(seen.callerOpts.authHeader, "Bearer npt_token");
  assert.equal(seen.listArgs[1], caller.userId);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

function postRoute(activeCaller, found = episode) {
  const state = { saved: [], publishSql: recordingSql(() => [{ id: episode.episode_id }]) };
  let currentEpisode = found;
  const council = requireCouncil;
  const route = loadRoute("app/api/episodes/[id]/fact-check/route.ts", {
    "next/server": require("next/server"),
    "@/auth": { auth: async () => null },
    "@/lib/current-user": { currentCaller: async () => activeCaller },
    "@/lib/db": { sql: state.publishSql },
    "@/lib/council": {
      findCouncilEpisode: async () => currentEpisode,
      parseStoredFactCheck: council.parseStoredFactCheck,
      saveCouncilFactCheck: async (sql, runId, showId, merged) => state.saved.push({ runId, showId, merged }),
      publishIfReady: council.publishIfReady,
    },
    "@/lib/fact-check": requireFactCheck,
  });
  return { route, state, setEpisode: (value) => (currentEpisode = value) };
}

// Filled once the async module imports resolve in the tests below.
let requireCouncil = null;
let requireFactCheck = null;

test("POST /api/episodes/:id/fact-check requires a caller", async () => {
  requireCouncil = await loadCouncil();
  requireFactCheck = await loadFactCheck();
  const { route, state } = postRoute(null);
  const res = await route.POST(post(passBody()), params());
  assert.equal(res.status, 401);
  assert.equal(state.saved.length, 0);
});

test("POST returns 404 for an unknown or someone else's episode", async () => {
  const { route, state, setEpisode } = postRoute(caller);
  setEpisode(null);
  const res = await route.POST(post(passBody()), params());
  assert.equal(res.status, 404);
  assert.equal(state.saved.length, 0);
});

test("POST returns 400 with the validator error and writes nothing", async () => {
  const { route, state } = postRoute(caller);
  const body = { ...passBody(), upheld: [{ persona: "quickdraw", kind: "wrong", message: "Bad", excerpt: "x" }] };
  const res = await route.POST(post(body), params());
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "verdict does not follow the unanimous rule" });
  assert.equal(state.saved.length, 0);
  assert.equal(state.publishSql.calls.length, 0);
});

test("POST merges, persists without clobbering layer-1 notes, and publishes an opted-in draft", async () => {
  const { route, state } = postRoute(caller);
  const res = await route.POST(post(passBody()), params());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.published, true);
  assert.equal(body.fact_check.verdict, "pass");
  assert.equal(body.fact_check.grade.score, "A", "no flags and no dismissals");
  assert.deepEqual(body.fact_check.notes, episode.fact_check.notes);
  assert.equal(body.fact_check.model, episode.fact_check.model);
  assert.equal(state.saved.length, 1);
  assert.deepEqual(state.saved[0].runId, episode.run_id);
  assert.deepEqual(state.saved[0].showId, episode.show_id);
  assert.equal(state.publishSql.calls.length, 1);
});

test("POST with a failing verdict never publishes", async () => {
  const { route, state } = postRoute(caller);
  const res = await route.POST(post(failBody()), params());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.published, false);
  assert.equal(body.fact_check.verdict, "fail");
  assert.equal(body.fact_check.agent_notes.length, 1);
  assert.equal(state.saved.length, 1);
  assert.equal(state.publishSql.calls.length, 0);
});

test("PATCH grade override is owner-scoped and preserves automatic grade", async () => {
  const { route, state, setEpisode } = postRoute(caller);
  setEpisode({ ...episode, fact_check: { ...episode.fact_check, grade: { score: "A", tags: [], error_types: [], caught_by: {}, notes: "Pass" } } });
  const res = await route.PATCH(patchGrade({ score: "D", notes: "Reviewed source" }), params());
  assert.equal(res.status, 200);
  assert.equal(state.saved[0].merged.grade.score, "D");
  assert.equal(state.saved[0].merged.grade.auto_score, "A");
  assert.equal(state.saved[0].merged.grade.notes, "Reviewed source");
});

test("PATCH rejects invalid grades and episodes without a council grade", async () => {
  const { route, state } = postRoute(caller);
  assert.equal((await route.PATCH(patchGrade({ score: "Z", notes: "bad" }), params())).status, 400);
  assert.equal(state.saved.length, 0);
});
