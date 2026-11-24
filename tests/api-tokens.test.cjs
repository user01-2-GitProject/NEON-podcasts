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

test("bearer policy: self-service carve-out covers /api/me/tokens* for members", async () => {
  const { bearerRequestAllowed, isSelfServicePath } = await import("../lib/api-tokens.ts");
  const member = { scope: "read_write", role: "member", ownerApproved: false };

  assert.equal(isSelfServicePath("/api/me/tokens"), true);
  assert.equal(isSelfServicePath("/api/me/tokens/abc"), true);
  assert.equal(isSelfServicePath("/api/shows"), false);

  // member read_write may mutate its own tokens...
  assert.equal(bearerRequestAllowed({ ...member, method: "GET", pathname: "/api/me/tokens" }), true);
  assert.equal(bearerRequestAllowed({ ...member, method: "DELETE", pathname: "/api/me/tokens" }), true);
  assert.equal(bearerRequestAllowed({ ...member, method: "DELETE", pathname: "/api/me/tokens/abc" }), true);
  // ...but still cannot mutate owner-only APIs
  assert.equal(bearerRequestAllowed({ ...member, method: "POST", pathname: "/api/shows" }), false);
});

const LIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("self-service covers exactly the four live participation paths", async () => {
  const { isSelfServicePath } = await import("../lib/api-tokens.ts");
  for (const action of ["join", "leave", "heartbeat", "turns"]) {
    assert.equal(isSelfServicePath(`/api/live/${LIVE}/${action}`), true, action);
  }
  for (const path of [
    "/api/live/sessions",
    `/api/live/${LIVE}`,
    `/api/live/${LIVE}/participants/${PID}`,
    `/api/live/${LIVE}/turns/x`,
    `/api/live/${LIVE}/join/`,
    "/api/live/not-a-uuid/join",
    "/api/live/sessions/join",
    `/api/live/${LIVE}/speak`,
    `/api/live/x/${LIVE}/join`,
  ]) {
    assert.equal(isSelfServicePath(path), false, path);
  }
});

test("bearer policy for live sessions: members participate, owners moderate", async () => {
  const { bearerRequestAllowed } = await import("../lib/api-tokens.ts");
  const member = { scope: "read_write", role: "member", ownerApproved: false };
  const listener = { scope: "read_only", role: "member", ownerApproved: false };
  const owner = { scope: "read_write", role: "owner", ownerApproved: true };

  for (const action of ["join", "leave", "heartbeat", "turns"]) {
    const pathname = `/api/live/${LIVE}/${action}`;
    assert.equal(bearerRequestAllowed({ ...member, method: "POST", pathname }), true, action);
    assert.equal(bearerRequestAllowed({ ...listener, method: "POST", pathname }), false, action);
  }
  // read_only agents can still listen
  assert.equal(bearerRequestAllowed({ ...listener, method: "GET", pathname: `/api/live/${LIVE}/turns` }), true);
  assert.equal(bearerRequestAllowed({ ...listener, method: "GET", pathname: "/api/live/sessions" }), true);

  const ownerOnly = [
    ["POST", "/api/live/sessions"],
    ["PATCH", `/api/live/${LIVE}`],
    ["PATCH", `/api/live/${LIVE}/participants/${PID}`],
    ["POST", `/api/live/${LIVE}/turns/x`],
    ["POST", "/api/live/sessions/join"],
  ];
  for (const [method, pathname] of ownerOnly) {
    assert.equal(bearerRequestAllowed({ ...member, method, pathname }), false, `${method} ${pathname}`);
  }
  for (const [method, pathname] of ownerOnly.slice(0, 3)) {
    assert.equal(bearerRequestAllowed({ ...owner, method, pathname }), true, `${method} ${pathname}`);
  }
});

test("bearer tokens can never mint tokens", async () => {
  const { bearerForbiddenPath } = await import("../lib/api-tokens.ts");
  assert.equal(bearerForbiddenPath("/api/me/tokens", "POST"), true);
  assert.equal(bearerForbiddenPath("/api/me/tokens/connect", "POST"), true);
  assert.equal(bearerForbiddenPath("/api/tokens", "GET"), true);
  assert.equal(bearerForbiddenPath("/api/tokens/abc", "DELETE"), true);
  // listing and revoking your own tokens with a bearer token still works
  assert.equal(bearerForbiddenPath("/api/me/tokens", "GET"), false);
  assert.equal(bearerForbiddenPath("/api/me/tokens", "DELETE"), false);
  assert.equal(bearerForbiddenPath("/api/me/tokens/abc", "DELETE"), false);
});
