const { test } = require("node:test");
const assert = require("node:assert/strict");

// Returns the scripted rows for each successive query.
function scriptedSql(responses = []) {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return responses[calls.length - 1] ?? [];
  };
  fn.calls = calls;
  return fn;
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const limits = { episodesPerDay: 3, costCentsPerDay: 50 };

test("caps come from app_settings, falling back to defaults for unset or bad values", async () => {
  const { parseLimits, getLimits, DEFAULT_LIMITS, LIMIT_KEYS } = await import("../lib/limits.ts");
  assert.deepEqual(parseLimits({}), DEFAULT_LIMITS);
  assert.deepEqual(parseLimits({ [LIMIT_KEYS.episodesPerDay]: "10", [LIMIT_KEYS.costCentsPerDay]: " 250 " }), {
    episodesPerDay: 10,
    costCentsPerDay: 250,
  });
  assert.deepEqual(parseLimits({ [LIMIT_KEYS.episodesPerDay]: "-1", [LIMIT_KEYS.costCentsPerDay]: "lots" }), DEFAULT_LIMITS);
  assert.equal(parseLimits({ [LIMIT_KEYS.episodesPerDay]: "0" }).episodesPerDay, 0); // 0 = members can't generate

  const db = scriptedSql([[{ key: LIMIT_KEYS.episodesPerDay, value: "7" }]]);
  assert.deepEqual(await getLimits(db), { episodesPerDay: 7, costCentsPerDay: DEFAULT_LIMITS.costCentsPerDay });
  assert.deepEqual(db.calls[0].values, [LIMIT_KEYS.episodesPerDay, LIMIT_KEYS.costCentsPerDay]);
});

test("owners are unlimited no matter their usage", async () => {
  const { decideGeneration } = await import("../lib/limits.ts");
  assert.deepEqual(decideGeneration({ isOwner: true, usage: { episodes: 999, costCents: 99999 }, limits }), {
    allowed: true,
    unlimited: true,
  });
});

test("members are allowed under the episode cap and refused at it", async () => {
  const { decideGeneration } = await import("../lib/limits.ts");
  assert.deepEqual(decideGeneration({ isOwner: false, usage: { episodes: 2, costCents: 10 }, limits }), {
    allowed: true,
    unlimited: false,
  });
  const denied = decideGeneration({ isOwner: false, usage: { episodes: 3, costCents: 10 }, limits });
  assert.equal(denied.allowed, false);
  assert.equal(denied.limit, "episodes");
  assert.equal(denied.reason, "Daily generation limit reached (3 episodes/day). Try again tomorrow.");
});

test("members are refused once the daily cost cap is reached", async () => {
  const { decideGeneration } = await import("../lib/limits.ts");
  const denied = decideGeneration({ isOwner: false, usage: { episodes: 1, costCents: 50 }, limits });
  assert.equal(denied.allowed, false);
  assert.equal(denied.limit, "cost");
  assert.match(denied.reason, /\$0\.50\/day/);
  assert.equal(decideGeneration({ isOwner: false, usage: { episodes: 1, costCents: 49 }, limits }).allowed, true);
});

test("getUsage counts only the user's shows over the last 24 hours", async () => {
  const { getUsage } = await import("../lib/limits.ts");
  const db = scriptedSql([[{ episodes: "2", cost_cents: "37" }]]);
  assert.deepEqual(await getUsage(db, USER), { episodes: 2, costCents: 37 });
  const { text, values } = db.calls[0];
  assert.match(text, /from runs r\s+join shows s on s\.id = r\.show_id/);
  assert.match(text, /where s\.user_id = \?/);
  assert.match(text, /interval '24 hours'/);
  assert.match(text, /r\.status = 'done' or \(r\.status = 'running'/); // in-flight runs count too
  assert.deepEqual(values, [[], USER]);

  const excluding = scriptedSql([[{ episodes: 0, cost_cents: 0 }]]);
  await getUsage(excluding, USER, ["run-1"]);
  assert.deepEqual(excluding.calls[0].values, [["run-1"], USER]);
  assert.deepEqual(await getUsage(scriptedSql([[]]), USER), { episodes: 0, costCents: 0 });
});

test("checkGeneration skips the database for owners and ownerless shows", async () => {
  const { checkGeneration } = await import("../lib/limits.ts");
  const db = scriptedSql();
  assert.equal((await checkGeneration(db, { userId: USER, isOwner: true })).allowed, true);
  assert.equal((await checkGeneration(db, null)).allowed, true);
  assert.equal(db.calls.length, 0);

  const member = scriptedSql([[{ episodes: 5, cost_cents: 0 }], []]);
  const decision = await checkGeneration(member, { userId: USER, isOwner: false });
  assert.equal(decision.allowed, false);
  assert.deepEqual(member.calls[0].values, [[], USER]);
});

test("a scheduler batch approves runs in order until each user's cap", async () => {
  const { planScheduledRuns } = await import("../lib/limits.ts");
  const member = { userId: USER, isOwner: false };
  const other = { userId: OTHER, isOwner: false };
  const plan = planScheduledRuns(
    [
      { runId: "a", subject: member },
      { runId: "b", subject: member },
      { runId: "c", subject: member },
      { runId: "d", subject: other },
      { runId: "e", subject: { userId: OTHER, isOwner: true } },
      { runId: "f", subject: null },
    ],
    new Map([[USER, { episodes: 1, costCents: 0 }]]),
    limits,
  );
  assert.deepEqual(plan.allowed, ["a", "b", "d", "e", "f"]);
  assert.deepEqual(plan.skipped.map((s) => s.runId), ["c"]);
  assert.match(plan.skipped[0].reason, /3 episodes\/day/);
});

test("the scheduler batch doesn't count its own claimed runs as prior usage", async () => {
  const { decideScheduledBatch } = await import("../lib/limits.ts");
  const member = [{ id: USER, role: "member", owner_approved: false }];
  const db = scriptedSql([member, member, [], [{ episodes: 0, cost_cents: 0 }]]);
  const plan = await decideScheduledBatch(db, [
    { id: "run-1", show_id: "s1" },
    { id: "run-2", show_id: "s2" },
  ]);
  assert.deepEqual(plan, { allowed: ["run-1", "run-2"], skipped: [] });
  assert.deepEqual(db.calls[0].values, ["s1"]);
  assert.deepEqual(db.calls[3].values, [["run-1", "run-2"], USER]);

  // owner-only batches never read limits or usage
  const owners = scriptedSql([[{ id: USER, role: "owner", owner_approved: true }]]);
  assert.deepEqual(await decideScheduledBatch(owners, [{ id: "run-1", show_id: "s1" }]), { allowed: ["run-1"], skipped: [] });
  assert.equal(owners.calls.length, 1);
});

test("a skipped scheduled run records the reason and advances the show", async () => {
  const { skipScheduledRun } = await import("../lib/limits.ts");
  const db = scriptedSql();
  await skipScheduledRun(db, "run-1", "Daily generation limit reached");
  const { text, values } = db.calls[0];
  assert.match(text, /status = 'skipped'/);
  assert.match(text, /where id = \? and status = 'running'/);
  assert.match(text, /update shows set next_run_at/);
  assert.doesNotMatch(text, /delete/i);
  assert.deepEqual(values, ["Daily generation limit reached", "run-1"]);
});
