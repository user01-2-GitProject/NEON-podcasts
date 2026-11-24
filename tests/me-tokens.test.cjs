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

const USER = "11111111-1111-1111-1111-111111111111";
const TOKEN = "22222222-2222-2222-2222-222222222222";

test("listMyTokens is always scoped to the caller's id", async () => {
  const { listMyTokens } = await import("../lib/me-tokens.ts");
  const db = fakeSql([{ id: TOKEN, label: "mobile", scope: "read_write" }]);
  await listMyTokens(db, USER);
  assert.match(db.calls[0].text, /from api_tokens/);
  assert.match(db.calls[0].text, /where created_by =/);
  assert.deepEqual(db.calls[0].values, [USER]);
});

test("revokeMyToken sets revoked_at and is scoped to id + caller", async () => {
  const { revokeMyToken } = await import("../lib/me-tokens.ts");
  const hit = fakeSql([{ id: TOKEN }]);
  assert.equal(await revokeMyToken(hit, USER, TOKEN), true);
  assert.match(hit.calls[0].text, /update api_tokens set revoked_at = now\(\)/);
  assert.match(hit.calls[0].text, /created_by =/);
  assert.match(hit.calls[0].text, /revoked_at is null/);
  // id first, then caller id — both bound, so one user can never revoke another's token
  assert.deepEqual(hit.calls[0].values, [TOKEN, USER]);

  const miss = fakeSql([]); // not mine / already revoked
  assert.equal(await revokeMyToken(miss, USER, TOKEN), false);
});

test("revokeAllMyTokens revokes only the caller's active tokens and counts them", async () => {
  const { revokeAllMyTokens } = await import("../lib/me-tokens.ts");
  const db = fakeSql([{ id: "a" }, { id: "b" }]);
  assert.equal(await revokeAllMyTokens(db, USER), 2);
  assert.match(db.calls[0].text, /update api_tokens set revoked_at = now\(\)/);
  assert.match(db.calls[0].text, /created_by =/);
  assert.match(db.calls[0].text, /revoked_at is null/);
  assert.deepEqual(db.calls[0].values, [USER]);
});
