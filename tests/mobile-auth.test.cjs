const { test } = require("node:test");
const assert = require("node:assert/strict");

function fakeSql(responses) {
  // responses: array of row-arrays returned in call order
  const calls = [];
  let i = 0;
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    const r = responses[i] ?? [];
    i += 1;
    return r;
  };
  fn.calls = calls;
  return fn;
}

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

test("rejects a missing id_token", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const res = await exchangeGoogleIdToken({
    idToken: undefined,
    allowedAudiences: [CLIENT_ID],
    db: fakeSql([]),
    verify: async () => { throw new Error("verify should not be called"); },
  });
  assert.equal(res.status, 400);
});

test("rejects an unverified email", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const res = await exchangeGoogleIdToken({
    idToken: "x",
    allowedAudiences: [CLIENT_ID],
    db: fakeSql([]),
    verify: async () => ({ email: "a@x.com", email_verified: "false", aud: CLIENT_ID }),
  });
  assert.equal(res.status, 401);
});

test("rejects an audience mismatch", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const res = await exchangeGoogleIdToken({
    idToken: "x",
    allowedAudiences: [CLIENT_ID],
    db: fakeSql([]),
    verify: async () => ({ email: "a@x.com", email_verified: "true", aud: "someone-else" }),
  });
  assert.equal(res.status, 401);
});

test("rejects when tokeninfo returns null (invalid token)", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const res = await exchangeGoogleIdToken({
    idToken: "x",
    allowedAudiences: [CLIENT_ID],
    db: fakeSql([]),
    verify: async () => null,
  });
  assert.equal(res.status, 401);
});

test("mints a read_write token and upserts the user on a valid id_token", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const db = fakeSql([[{ id: "user-123", role: "member" }], []]);
  const res = await exchangeGoogleIdToken({
    idToken: "x",
    allowedAudiences: [CLIENT_ID],
    db,
    verify: async () => ({ email: "A@X.com", email_verified: "true", aud: CLIENT_ID }),
    genToken: () => "npt_" + "a".repeat(64),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.email, "a@x.com");
  assert.equal(res.body.role, "member");
  assert.equal(res.body.token, "npt_" + "a".repeat(64));
  // first call upserts user, second inserts the api_token
  assert.match(db.calls[0].text, /insert into users/);
  assert.match(db.calls[0].text, /on conflict/);
  assert.match(db.calls[1].text, /insert into api_tokens/);
  // token stored as a hash, scope read_write, label mobile:<email>
  assert.ok(db.calls[1].values.includes("read_write"));
  assert.ok(db.calls[1].values.includes("mobile:a@x.com"));
  assert.ok(db.calls[1].values.includes("user-123"));
});

const MOBILE_AUD = "ios-client-id.apps.googleusercontent.com";

test("accepts a token whose aud is a configured mobile client id", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const db = fakeSql([[{ id: "user-9", role: "member" }], []]);
  const res = await exchangeGoogleIdToken({
    idToken: "x",
    allowedAudiences: [CLIENT_ID, MOBILE_AUD],
    db,
    verify: async () => ({ email: "fan@x.com", email_verified: "true", aud: MOBILE_AUD }),
    genToken: () => "npt_" + "d".repeat(64),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.email, "fan@x.com");
});

test("500 when no audiences are configured", async () => {
  const { exchangeGoogleIdToken } = await import("../lib/mobile-auth.ts");
  const res = await exchangeGoogleIdToken({
    idToken: "x",
    allowedAudiences: [],
    db: fakeSql([]),
    verify: async () => { throw new Error("verify should not be called"); },
  });
  assert.equal(res.status, 500);
});

test("allowedGoogleAudiences merges GOOGLE_CLIENT_ID and GOOGLE_MOBILE_CLIENT_IDS, de-duped", async () => {
  const { allowedGoogleAudiences } = await import("../lib/mobile-auth.ts");
  const list = allowedGoogleAudiences({
    GOOGLE_CLIENT_ID: "web.apps.googleusercontent.com",
    GOOGLE_MOBILE_CLIENT_IDS: " ios.apps.googleusercontent.com , android.apps.googleusercontent.com ,web.apps.googleusercontent.com",
  });
  assert.deepEqual(list, [
    "web.apps.googleusercontent.com",
    "ios.apps.googleusercontent.com",
    "android.apps.googleusercontent.com",
  ]);
  assert.deepEqual(allowedGoogleAudiences({}), []);
});
