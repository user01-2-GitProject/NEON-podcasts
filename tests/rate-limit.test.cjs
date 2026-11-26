const { test } = require("node:test");
const assert = require("node:assert/strict");

test("allows 5 attempts per minute per key, rejects the 6th", async () => {
  const { createRateLimiter } = await import("../lib/rate-limit.ts");
  let now = 1_000_000;
  const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => now });
  for (let i = 0; i < 5; i++) assert.equal(limiter.hit("1.2.3.4").ok, true);
  const sixth = limiter.hit("1.2.3.4");
  assert.equal(sixth.ok, false);
  assert.ok(sixth.retryAfterSeconds > 0 && sixth.retryAfterSeconds <= 60);
  // Other IPs are unaffected.
  assert.equal(limiter.hit("5.6.7.8").ok, true);
  // After the window passes, the key is allowed again.
  now += 60_001;
  assert.equal(limiter.hit("1.2.3.4").ok, true);
});

test("evicts the oldest keys past maxKeys so memory stays bounded", async () => {
  const { createRateLimiter } = await import("../lib/rate-limit.ts");
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 });
  limiter.hit("a"); limiter.hit("b"); limiter.hit("c");
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.hit("a").ok, true, "a was evicted, so it starts fresh");
});

test("clientIp reads the first x-forwarded-for hop, then x-real-ip", async () => {
  const { clientIp } = await import("../lib/rate-limit.ts");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })), "9.9.9.9");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } })), "8.8.8.8");
  assert.equal(clientIp(new Request("http://x")), "unknown");
});
