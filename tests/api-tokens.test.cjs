const { test } = require("node:test");
const assert = require("node:assert/strict");

test("new tokens are random and hash to a fixed database value", async () => {
  const { newApiToken, tokenHash, bearerToken } = await import("../lib/api-tokens.ts");
  const first = newApiToken();
  const second = newApiToken();
  assert.match(first, /^npt_[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.equal(bearerToken(`Bearer ${first}`), first);
  assert.equal(bearerToken("Bearer invalid"), null);
  assert.equal(bearerToken(null), null);
  assert.match(await tokenHash(first), /^[0-9a-f]{64}$/);
  assert.notEqual(await tokenHash(first), first);
  assert.notEqual(await tokenHash(first), await tokenHash(second));
});

test("read-only scope cannot mutate", async () => {
  const { scopeAllows } = await import("../lib/api-tokens.ts");
  assert.equal(scopeAllows("read_only", "GET"), true);
  assert.equal(scopeAllows("read_only", "POST"), false);
  assert.equal(scopeAllows("read_only", "DELETE"), false);
  assert.equal(scopeAllows("read_write", "POST"), true);
});
