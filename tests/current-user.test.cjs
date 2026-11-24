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
