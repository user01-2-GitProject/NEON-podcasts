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

test("prefers the session email and normalizes it", async () => {
  const { currentUserEmail } = await import("../lib/current-user.ts");
  const db = fakeSql();
  const email = await currentUserEmail({
    session: { user: { email: "Owner@X.com" } },
    authHeader: "Bearer npt_" + "a".repeat(64),
    db,
  });
  assert.equal(email, "owner@x.com");
  assert.equal(db.calls.length, 0); // never touched the DB when a session exists
});

test("resolves the email from a bearer token when there is no session", async () => {
  const { currentUserEmail } = await import("../lib/current-user.ts");
  const db = fakeSql([{ email: "Member@X.com" }]);
  const email = await currentUserEmail({
    session: null,
    authHeader: "Bearer npt_" + "b".repeat(64),
    db,
  });
  assert.equal(email, "member@x.com");
  assert.match(db.calls[0].text, /api_tokens/);
  assert.match(db.calls[0].text, /join users/);
});

test("returns null for no session and no/invalid bearer token", async () => {
  const { currentUserEmail } = await import("../lib/current-user.ts");
  assert.equal(await currentUserEmail({ session: null, authHeader: null, db: fakeSql() }), null);
  assert.equal(await currentUserEmail({ session: null, authHeader: "Bearer garbage", db: fakeSql() }), null);
});

test("a bearer token for a follow resolves the subscriber email for follow()", async () => {
  const { currentUserEmail } = await import("../lib/current-user.ts");
  const { follow } = await import("../lib/subscriptions.ts");
  const lookupDb = fakeSql([{ email: "fan@x.com" }]);
  const email = await currentUserEmail({
    session: null,
    authHeader: "Bearer npt_" + "c".repeat(64),
    db: lookupDb,
  });
  assert.equal(email, "fan@x.com");
  const followDb = fakeSql();
  await follow(followDb, email, "12345678-1234-1234-1234-123456789abc");
  assert.deepEqual(followDb.calls[0].values, ["fan@x.com", "12345678-1234-1234-1234-123456789abc"]);
});

test("currentCaller returns the calling token's id and label for live kind", async () => {
  const { currentCaller } = await import("../lib/current-user.ts");
  const row = { user_id: "u1", email: "Bot@X.com", role: "member", owner_approved: false, token_id: "t1", token_label: "agent:cohost" };
  const db = fakeSql([row]);
  const caller = await currentCaller({ session: null, authHeader: "Bearer npt_" + "c".repeat(64), db });
  assert.deepEqual(caller, { userId: "u1", email: "bot@x.com", role: "member", ownerApproved: false, tokenId: "t1", tokenLabel: "agent:cohost" });
  assert.match(db.calls[0].text, /t\.label as token_label/);
  assert.match(db.calls[0].text, /revoked_at is null/);
  assert.notEqual(db.calls[0].values[0], "npt_" + "c".repeat(64)); // looked up by hash, never the raw token
});

test("currentCaller for a browser session has no token; revoked/unknown tokens resolve to null", async () => {
  const { currentCaller } = await import("../lib/current-user.ts");
  const db = fakeSql([{ user_id: "u1", email: "a@x.com", role: "owner", owner_approved: true, token_id: null, token_label: null }]);
  const caller = await currentCaller({ session: { user: { email: "A@X.com" } }, authHeader: null, db });
  assert.equal(caller.tokenId, null);
  assert.equal(caller.tokenLabel, null);
  assert.deepEqual(db.calls[0].values, ["a@x.com"]);
  assert.equal(await currentCaller({ session: null, authHeader: "Bearer npt_" + "d".repeat(64), db: fakeSql([]) }), null);
  assert.equal(await currentCaller({ session: null, authHeader: null, db: fakeSql() }), null);
});
