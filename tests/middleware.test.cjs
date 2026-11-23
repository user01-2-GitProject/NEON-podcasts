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
