const { test } = require("node:test");
const assert = require("node:assert/strict");

// Returns the scripted rows for each successive query (an Error is thrown).
function scriptedSql(responses = []) {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    const next = responses[calls.length - 1];
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  fn.calls = calls;
  return fn;
}

const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const EVIL = "66666666-6666-4666-8666-666666666666";

const browser = { userId: USER, email: "a@x.com", role: "member", ownerApproved: false, tokenId: null, tokenLabel: null };
const agent = { ...browser, tokenId: TOKEN, tokenLabel: "agent:cohost" };
const phone = { ...browser, tokenId: TOKEN, tokenLabel: "mobile:a@x.com" };

const liveSession = (extra = {}) => ({ status: "live", max_participants: 12, created_by: OTHER, others: "0", ...extra });
const joined = { id: "p1", display_name: "Bot", kind: "agent", role: "listener", muted: false, away: false };

test("kind is agent only for an agent: token label", async () => {
  const { participantKind } = await import("../lib/live.ts");
  assert.equal(participantKind("agent:cohost"), "agent");
  assert.equal(participantKind("mobile:a@x.com"), "human");
  assert.equal(participantKind(null), "human");
  assert.equal(participantKind("my agent:bot"), "human");
  assert.equal(participantKind("Agent:bot"), "human");
});

test("an agent token joins keyed by its token, bound to the caller", async () => {
  const { joinSession } = await import("../lib/live.ts");
  const db = scriptedSql([[], [liveSession()], [joined]]);
  const participant = await joinSession(db, agent, SESSION, "Bot");
  assert.equal(participant.id, "p1");

  const [sweep, capacity, insert] = db.calls;
  assert.match(sweep.text, /set left_at = now\(\)/);
  assert.deepEqual(capacity.values, [USER, TOKEN, "token", SESSION]);
  assert.match(insert.text, /insert into live_participants/);
  assert.match(insert.text, /on conflict \(session_id, token_id\) where token_id is not null/);
  assert.match(insert.text, /'token'/);
  assert.deepEqual(insert.values, [SESSION, USER, TOKEN, "agent", "listener", "Bot"]);
});

test("browser and phone-app callers join as humans; the creator joins as host", async () => {
  const { joinSession } = await import("../lib/live.ts");

  const web = scriptedSql([[], [liveSession()], [joined]]);
  await joinSession(web, browser, SESSION, "Ann");
  assert.match(web.calls[2].text, /'browser'/);
  assert.match(web.calls[2].text, /on conflict \(session_id, user_id\) where via = 'browser'/);
  assert.deepEqual(web.calls[2].values, [SESSION, USER, "human", "listener", "Ann"]);

  const app = scriptedSql([[], [liveSession()], [joined]]);
  await joinSession(app, phone, SESSION, "Ann");
  assert.deepEqual(app.calls[2].values, [SESSION, USER, TOKEN, "human", "listener", "Ann"]);

  const host = scriptedSql([[], [liveSession({ created_by: USER })], [joined]]);
  await joinSession(host, browser, SESSION, "Ann");
  assert.equal(host.calls[2].values[3], "host");
});

test("join is refused for unknown, not-live, full sessions and removed participants", async () => {
  const { joinSession, LiveError } = await import("../lib/live.ts");
  const attempt = (rows) => joinSession(scriptedSql(rows), agent, SESSION, "Bot");
  const status = async (rows) => {
    const err = await attempt(rows).catch((e) => e);
    assert.ok(err instanceof LiveError, String(err));
    return err.status;
  };
  assert.equal(await status([[], []]), 404);
  assert.equal(await status([[], [liveSession({ status: "scheduled" })]]), 409);
  assert.equal(await status([[], [liveSession({ status: "ended" })]]), 409);
  assert.equal(await status([[], [liveSession({ max_participants: 2, others: "2" })]]), 409);
  assert.equal(await status([[], [liveSession()], []]), 403); // upsert skipped: removed
});

test("ids never come from the request body", async () => {
  const { checkDisplayName, checkTurn, joinSession, postTurn } = await import("../lib/live.ts");
  const name = checkDisplayName({ display_name: "Bot", user_id: EVIL, token_id: EVIL, participant_id: EVIL, kind: "human" });
  const turn = checkTurn({ kind: "chat", text: "hi", participant_id: EVIL, user_id: EVIL, session_id: EVIL });
  assert.deepEqual(turn, { kind: "chat", text: "hi" });

  const join = scriptedSql([[], [liveSession()], [joined]]);
  await joinSession(join, agent, SESSION, name);
  const speak = scriptedSql([[{ id: "p1", role: "guest", muted: false, removed: false, left_at: null, status: "live", cooling_down: false }], [{ seq: 1 }]]);
  await postTurn(speak, agent, SESSION, turn);
  for (const call of [...join.calls, ...speak.calls]) {
    assert.ok(!call.values.includes(EVIL), `body id leaked into: ${call.text}`);
  }
  // kind comes from the token label, not the body
  assert.equal(join.calls[2].values[3], "agent");
});

test("a turn is posted as the caller's own participant with the next seq", async () => {
  const { postTurn } = await import("../lib/live.ts");
  const db = scriptedSql([
    [{ id: "p1", role: "guest", muted: false, removed: false, left_at: null, status: "live", cooling_down: false }],
    [{ seq: "7" }],
  ]);
  assert.deepEqual(await postTurn(db, agent, SESSION, { kind: "speech", text: "hello" }), { seq: 7 });
  const [lookup, insert] = db.calls;
  assert.match(lookup.text, /p\.user_id = \?/);
  assert.match(lookup.text, /p\.token_id is not distinct from \?::uuid/);
  assert.deepEqual(lookup.values, [3, SESSION, USER, TOKEN, "token"]);
  assert.match(insert.text, /coalesce\(max\(seq\), 0\) \+ 1/);
  assert.deepEqual(insert.values, [SESSION, "p1", "speech", "hello", SESSION]);
});

test("turns are refused for non-participants, left/removed/muted listeners, ended sessions and spam", async () => {
  const { postTurn, LiveError } = await import("../lib/live.ts");
  const me = (extra = {}) => ({ id: "p1", role: "guest", muted: false, removed: false, left_at: null, status: "live", cooling_down: false, ...extra });
  const status = async (row, kind = "speech") => {
    const err = await postTurn(scriptedSql([row ? [row] : []]), agent, SESSION, { kind, text: "x" }).catch((e) => e);
    assert.ok(err instanceof LiveError, String(err));
    return err.status;
  };
  assert.equal(await status(null), 403); // not a participant (or a revoked token resolved to no caller row)
  assert.equal(await status(me({ left_at: "2026-11-23T00:00:00Z" })), 403); // left, e.g. token revoked
  assert.equal(await status(me({ removed: true })), 403);
  assert.equal(await status(me({ status: "ended" })), 409);
  assert.equal(await status(me({ role: "listener" })), 403);
  assert.equal(await status(me({ muted: true })), 403);
  assert.equal(await status(me({ cooling_down: true }), "chat"), 429);

  // a muted participant and a listener can still chat
  const chat = scriptedSql([[me({ role: "listener", muted: true })], [{ seq: 2 }]]);
  assert.deepEqual(await postTurn(chat, agent, SESSION, { kind: "chat", text: "x" }), { seq: 2 });
});

test("a seq race retries once, then gives up", async () => {
  const { postTurn } = await import("../lib/live.ts");
  const me = [{ id: "p1", role: "host", muted: false, removed: false, left_at: null, status: "live", cooling_down: false }];
  const race = Object.assign(new Error("duplicate key"), { code: "23505" });
  const retried = scriptedSql([me, race, [{ seq: 5 }]]);
  assert.deepEqual(await postTurn(retried, browser, SESSION, { kind: "speech", text: "x" }), { seq: 5 });
  assert.equal(retried.calls.length, 3);
  await assert.rejects(postTurn(scriptedSql([me, race, race]), browser, SESSION, { kind: "speech", text: "x" }), /duplicate key/);
});

test("a revoked or deleted token marks its participant left without deleting turns", async () => {
  const { listParticipants, markDepartedTokens } = await import("../lib/live.ts");
  const db = scriptedSql();
  await markDepartedTokens(db, SESSION);
  const sweep = db.calls[0].text;
  assert.match(sweep, /update live_participants p set left_at = now\(\)/);
  assert.match(sweep, /p\.via = 'token'/);
  assert.match(sweep, /p\.token_id is null/);
  assert.match(sweep, /revoked_at is not null/);
  assert.doesNotMatch(sweep, /delete/i);
  assert.deepEqual(db.calls[0].values, [SESSION]);

  // presence always sweeps first, then lists only present participants
  const list = scriptedSql([[], [{ ...joined, away: true }]]);
  const people = await listParticipants(list, SESSION);
  assert.match(list.calls[0].text, /set left_at = now\(\)/);
  assert.match(list.calls[1].text, /left_at is null and not removed/);
  assert.equal(people[0].away, true);
  assert.equal("email" in people[0], false);
});

test("heartbeat and leave touch only the caller's own row", async () => {
  const { heartbeat, leaveSession } = await import("../lib/live.ts");
  for (const fn of [heartbeat, leaveSession]) {
    const viaToken = scriptedSql([[{ id: "p1" }]]);
    assert.equal(await fn(viaToken, agent, SESSION), true);
    assert.deepEqual(viaToken.calls[0].values, [SESSION, USER, TOKEN, "token"]);
    const viaBrowser = scriptedSql([[]]);
    assert.equal(await fn(viaBrowser, browser, SESSION), false);
    assert.deepEqual(viaBrowser.calls[0].values, [SESSION, USER, null, "browser"]);
    assert.doesNotMatch(viaToken.calls[0].text, /delete/i);
  }
});

test("turn feed pages by seq and keeps turns from departed participants", async () => {
  const { listTurns, LiveError } = await import("../lib/live.ts");
  const db = scriptedSql([[{ seq: "3", kind: "chat", text: "hi", created_at: "2026-11-23T10:00:00Z", participant_id: "p1", display_name: "Bot", participant_kind: "agent", role: "listener" }]]);
  const turns = await listTurns(db, SESSION, "2");
  assert.deepEqual(db.calls[0].values, [SESSION, 2, 200]);
  assert.doesNotMatch(db.calls[0].text, /left_at/);
  assert.deepEqual(turns[0], {
    seq: 3,
    kind: "chat",
    text: "hi",
    created_at: "2026-11-23T10:00:00.000Z",
    participant: { id: "p1", display_name: "Bot", kind: "agent", role: "listener" },
  });
  await assert.rejects(listTurns(scriptedSql(), SESSION, "-1"), LiveError);
  await assert.rejects(listTurns(scriptedSql(), SESSION, "abc"), LiveError);
});

test("owner controls: status transitions and participant moderation", async () => {
  const { setSessionStatus, updateParticipant, checkParticipantPatch, isLiveOwner, LiveError } = await import("../lib/live.ts");
  assert.equal(isLiveOwner({ ...browser, role: "owner", ownerApproved: true }), true);
  assert.equal(isLiveOwner({ ...browser, role: "owner", ownerApproved: false }), false);
  assert.equal(isLiveOwner(agent), false);

  await assert.rejects(setSessionStatus(scriptedSql(), SESSION, "scheduled"), (e) => e instanceof LiveError && e.status === 400);
  const live = scriptedSql([[{ id: SESSION, status: "live" }]]);
  assert.equal((await setSessionStatus(live, SESSION, "live")).status, "live");
  assert.match(live.calls[0].text, /status = 'scheduled'/);
  const stuck = scriptedSql([[], [{ id: SESSION, status: "ended" }]]);
  await assert.rejects(setSessionStatus(stuck, SESSION, "live"), (e) => e instanceof LiveError && e.status === 409);
  await assert.rejects(setSessionStatus(scriptedSql([[], []]), SESSION, "ended"), (e) => e instanceof LiveError && e.status === 404);

  assert.deepEqual(checkParticipantPatch({ role: "guest", muted: true }), { role: "guest", muted: true });
  assert.throws(() => checkParticipantPatch({}), LiveError);
  assert.throws(() => checkParticipantPatch({ role: "owner" }), LiveError);
  assert.throws(() => checkParticipantPatch({ muted: "yes" }), LiveError);
  const mod = scriptedSql([[{ ...joined, role: "guest" }]]);
  await updateParticipant(mod, SESSION, "33333333-3333-4333-8333-333333333333", { role: "guest" });
  assert.match(mod.calls[0].text, /where id = \? and session_id = \?/);
  await assert.rejects(updateParticipant(scriptedSql(), SESSION, "nope", { muted: true }), (e) => e.status === 404);
});

test("request validation", async () => {
  const { checkNewSession, checkTurn, checkDisplayName, LiveError } = await import("../lib/live.ts");
  assert.deepEqual(checkNewSession({ title: "  Friday   live " }), { title: "Friday live", showId: null, maxParticipants: 12 });
  assert.throws(() => checkNewSession({ title: "" }), LiveError);
  assert.throws(() => checkNewSession({ title: "x", show_id: "nope" }), LiveError);
  assert.throws(() => checkNewSession({ title: "x", max_participants: 0 }), LiveError);
  assert.throws(() => checkTurn({ kind: "system", text: "x" }), LiveError);
  assert.throws(() => checkTurn({ kind: "chat", text: "   " }), LiveError);
  assert.throws(() => checkTurn({ kind: "chat", text: "x".repeat(4001) }), LiveError);
  assert.throws(() => checkTurn(null), LiveError);
  assert.throws(() => checkDisplayName({ display_name: "x".repeat(41) }), LiveError);
  assert.throws(() => checkDisplayName({}), LiveError);
});
