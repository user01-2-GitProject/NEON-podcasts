const { test } = require("node:test");
const assert = require("node:assert/strict");

test("owner allowlist is case-insensitive and defaults to member", async () => {
  const { roleForEmail } = await import("../lib/auth.ts");
  const previous = process.env.OWNER_EMAILS;
  process.env.OWNER_EMAILS = " First@Example.com , second@example.com ";
  try {
    assert.equal(roleForEmail("first@example.com"), "owner");
    assert.equal(roleForEmail("SECOND@example.com"), "owner");
    assert.equal(roleForEmail("member@example.com"), "member");
  } finally {
    if (previous === undefined) delete process.env.OWNER_EMAILS;
    else process.env.OWNER_EMAILS = previous;
  }
});

test("password hashes verify the right password only", async () => {
  const { hashPassword, verifyPassword } = await import("../lib/auth.ts");
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.equal(await verifyPassword("anything", "malformed"), false);
});

test("owner enrollment requires the configured secret", async () => {
  const { validOwnerSecret } = await import("../lib/auth.ts");
  const previous = process.env.OWNER_SIGNUP_SECRET;
  process.env.OWNER_SIGNUP_SECRET = "a-private-owner-enrollment-secret";
  try {
    assert.equal(validOwnerSecret("a-private-owner-enrollment-secret"), true);
    assert.equal(validOwnerSecret("wrong"), false);
  } finally {
    if (previous === undefined) delete process.env.OWNER_SIGNUP_SECRET;
    else process.env.OWNER_SIGNUP_SECRET = previous;
  }
});
