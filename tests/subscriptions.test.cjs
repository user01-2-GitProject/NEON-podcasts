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

const showId = "12345678-1234-1234-1234-123456789abc";

test("follow is idempotent and binds email and show ID", async () => {
  const { follow } = await import("../lib/subscriptions.ts");
  const db = fakeSql();
  await follow(db, "a@x.com", showId);
  await follow(db, "a@x.com", showId);
  assert.equal(db.calls.length, 2);
  for (const call of db.calls) {
    assert.match(call.text, /on conflict/);
    assert.match(call.text, /do nothing/);
    assert.deepEqual(call.values, ["a@x.com", showId]);
  }
});

test("unfollow is scoped to the subscriber", async () => {
  const { unfollow } = await import("../lib/subscriptions.ts");
  const db = fakeSql();
  await unfollow(db, "a@x.com", showId);
  assert.match(db.calls[0].text, /subscriber_email/);
  assert.match(db.calls[0].text, /show_id/);
  assert.deepEqual(db.calls[0].values, ["a@x.com", showId]);
});

test("subscriber email requires a session and is normalized", async () => {
  const { subscriberEmail } = await import("../lib/subscriptions.ts");
  assert.equal(subscriberEmail(null), null);
  assert.equal(subscriberEmail({ user: {} }), null);
  assert.equal(subscriberEmail({ user: { email: "A@X.com" } }), "a@x.com");
});
