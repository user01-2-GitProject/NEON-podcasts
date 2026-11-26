const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { encode } = require("next-auth/jwt");

const secret = "0123456789abcdef0123456789abcdef";
process.env.AUTH_SECRET = secret;
process.env.AUTH_TRUST_HOST = "true";
process.env.OWNER_EMAILS = "owner@example.com";
const middleware = require("../middleware.ts").default;

async function request(path, { email, role, method = "GET", authorization, secure = false } = {}) {
  const protocol = secure ? "https" : "http";
  const headers = { host: "localhost:3000", "x-forwarded-proto": protocol };
  if (email) {
    const cookie = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
    const jwt = await encode({ token: { email, role, sub: "test-user" }, secret, salt: cookie });
    headers.cookie = `${cookie}=${jwt}`;
  }
  if (authorization) headers.authorization = authorization;
  return middleware(new NextRequest(`${protocol}://localhost:3000${path}`, { method, headers }));
}

test("Auth.js v5 session advances through middleware", async () => {
  const member = await request("/", { email: "member@example.com", role: "member" });
  assert.equal(member.status, 200);
  assert.equal(member.headers.get("x-middleware-next"), "1");
  assert.equal((await request("/", { email: "member@example.com", role: "member", secure: true })).status, 200);

  const owner = await request("/api/shows", { email: "owner@example.com", role: "owner", method: "POST" });
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get("x-middleware-next"), "1");
  assert.equal((await request("/api/shows", { email: "member@example.com", role: "member", method: "POST" })).status, 403);
});

test("members may manage subscriptions but cannot mutate other APIs", async () => {
  const subscriptions = await request("/api/subscriptions", { email: "member@example.com", role: "member", method: "POST" });
  assert.equal(subscriptions.status, 200);
  assert.equal(subscriptions.headers.get("x-middleware-next"), "1");
  assert.equal((await request("/api/shows", { email: "member@example.com", role: "member", method: "POST" })).status, 403);
});

test("anonymous, public, and bearer routes keep their policy", async () => {
  assert.equal((await request("/api/shows")).status, 401);
  const page = await request("/shows/example");
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location")).searchParams.get("next"), "/shows/example");
  assert.equal((await request("/feed/example")).status, 200);
  assert.equal((await request("/api/episodes/example/audio?feed=example")).status, 200);
  assert.equal((await request("/api/shows", { email: "owner@example.com", role: "owner", authorization: "Bearer invalid" })).status, 401);
  assert.equal((await request("/api/tokens", { email: "owner@example.com", role: "owner", authorization: "Bearer invalid" })).status, 403);
});

const LIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("live sessions: members participate, only owners create and moderate", async () => {
  const member = { email: "member@example.com", role: "member" };
  for (const action of ["join", "leave", "heartbeat", "turns"]) {
    const res = await request(`/api/live/${LIVE}/${action}`, { ...member, method: "POST" });
    assert.equal(res.headers.get("x-middleware-next"), "1", action);
  }
  assert.equal((await request("/api/live/sessions", { ...member, method: "POST" })).status, 403);
  assert.equal((await request(`/api/live/${LIVE}`, { ...member, method: "PATCH" })).status, 403);
  assert.equal((await request(`/api/live/${LIVE}/participants/${LIVE}`, { ...member, method: "PATCH" })).status, 403);
  assert.equal((await request(`/api/live/${LIVE}/turns/x`, { ...member, method: "POST" })).status, 403);
  assert.equal((await request("/api/live/sessions", { ...member })).headers.get("x-middleware-next"), "1");
  const owner = await request("/api/live/sessions", { email: "owner@example.com", role: "owner", method: "POST" });
  assert.equal(owner.headers.get("x-middleware-next"), "1");
  assert.equal((await request(`/api/live/${LIVE}/join`, { method: "POST" })).status, 401);
});

test("a bearer token cannot mint tokens, even on the member mint route", async () => {
  const res = await request("/api/me/tokens", { method: "POST", authorization: "Bearer npt_" + "e".repeat(64) });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "Please sign in on the website to do this. An app key can't.");
  // a cookie session may mint
  const cookie = await request("/api/me/tokens", { email: "member@example.com", role: "member", method: "POST" });
  assert.equal(cookie.headers.get("x-middleware-next"), "1");
});
