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

test("bearer policy: reads allowed by scope; mutations owner-only except subscriptions", async () => {
  const { bearerRequestAllowed } = await import("../lib/api-tokens.ts");
  const base = { role: "member", ownerApproved: false, pathname: "/api/shows" };

  // read_only can read anywhere, cannot mutate anything
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_only", method: "GET" }), true);
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_only", method: "POST" }), false);
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_only", method: "POST", pathname: "/api/subscriptions" }), false);

  // read_write member: reads ok; may mutate ONLY subscriptions
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_write", method: "GET" }), true);
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_write", method: "POST" }), false);
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_write", method: "POST", pathname: "/api/subscriptions" }), true);
  assert.equal(bearerRequestAllowed({ ...base, scope: "read_write", method: "DELETE", pathname: "/api/subscriptions/abc" }), true);

  // approved owner read_write: may mutate owner-only APIs
  assert.equal(bearerRequestAllowed({ scope: "read_write", role: "owner", ownerApproved: true, method: "POST", pathname: "/api/shows" }), true);
  // owner not yet approved is treated as non-owner for mutations
  assert.equal(bearerRequestAllowed({ scope: "read_write", role: "owner", ownerApproved: false, method: "POST", pathname: "/api/shows" }), false);
});
