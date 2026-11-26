const { test } = require("node:test");
const assert = require("node:assert/strict");

function fakeSql() {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [];
  };
  fn.calls = calls;
  fn.transaction = async (callback) => Promise.all(callback(fn));
  return fn;
}

const USER = "11111111-1111-1111-1111-111111111111";
const EMAIL = "member@example.com";

test("deleteAccount removes subscriptions by email and the caller user row in one transaction", async () => {
  const { deleteAccount } = await import("../lib/account.ts");
  const db = fakeSql();

  await deleteAccount(db, USER, EMAIL);

  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].text, /delete from subscriptions/);
  assert.match(db.calls[0].text, /subscriber_email =/);
  assert.deepEqual(db.calls[0].values, [EMAIL]);
  assert.match(db.calls[1].text, /delete from users/);
  assert.match(db.calls[1].text, /where id =/);
  assert.deepEqual(db.calls[1].values, [USER]);
});

test("owner account deletion is blocked to protect shared shows", async () => {
  const { accountDeletionBlock } = await import("../lib/account.ts");
  assert.deepEqual(accountDeletionBlock("owner", null), {
    status: 409,
    error: "Owners need to hand off or delete their shows before deleting the account.",
  });
});

test("agent token deletion is forbidden while mobile and cookie callers may proceed", async () => {
  const { accountDeletionBlock } = await import("../lib/account.ts");
  assert.deepEqual(accountDeletionBlock("member", "agent:research"), {
    status: 403,
    error: "An app key can't delete the account. Sign in on the website to do it.",
  });
  assert.equal(accountDeletionBlock("member", "mobile:phone"), null);
  assert.equal(accountDeletionBlock("member", null), null);
});
