const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const ts = require("typescript");

const USER = "11111111-1111-1111-1111-111111111111";
const TOKEN = "ExpoPushToken[dbf9a0c1-1234-5678-9abc-def012345678]";
const DEVICE = "android-m1g7x-4k9p2wq8";

function fakeSql() {
  const calls = [];
  const fn = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [{ id: "row-1" }];
  };
  fn.calls = calls;
  return fn;
}

// Transpile and run the real route with stubbed imports: no DB, no network,
// no Auth.js session required.
function loadRoute({ currentUserId = async () => USER, sql = fakeSql() } = {}) {
  const compiled = ts.transpileModule(readFileSync("app/api/me/push-token/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modules = {
    "next/server": require("next/server"),
    "@/lib/db": { sql },
    "@/lib/me": { currentUserId },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (!(name in modules)) throw new Error(`unexpected import ${name}`);
    return modules[name];
  }, exports);
  return { route: exports, sql };
}

const post = (body, headers = {}) =>
  new Request("https://app.test/api/me/push-token", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("push payload accepts an Expo token and a bounded device id", () => {
  const { parsePushTokenInput } = loadRoute().route;
  assert.deepEqual(parsePushTokenInput({ expo_push_token: ` ${TOKEN} `, device_id: ` ${DEVICE} ` }), {
    expoPushToken: TOKEN,
    deviceId: DEVICE,
  });
  assert.deepEqual(parsePushTokenInput({ expo_push_token: TOKEN, device_id: "ios-abc_1:2" }), {
    expoPushToken: TOKEN,
    deviceId: "ios-abc_1:2",
  });
});

test("push payload rejects malformed, oversized, and non-object input", () => {
  const { parsePushTokenInput } = loadRoute().route;
  const bad = [
    null,
    [],
    "string",
    {},
    { expo_push_token: TOKEN },
    { device_id: DEVICE },
    { expo_push_token: 42, device_id: DEVICE },
    { expo_push_token: TOKEN, device_id: 42 },
    { expo_push_token: "ExpoDevicePushToken[abc]", device_id: DEVICE },
    { expo_push_token: "ExpoPushToken[]", device_id: DEVICE },
    { expo_push_token: "ExpoPushToken[bad token]", device_id: DEVICE },
    { expo_push_token: "e".repeat(600), device_id: DEVICE },
    { expo_push_token: TOKEN, device_id: "" },
    { expo_push_token: TOKEN, device_id: "a".repeat(129) },
    { expo_push_token: TOKEN, device_id: "bad device id" },
    { expo_push_token: TOKEN, device_id: "<script>" },
  ];
  for (const input of bad) {
    assert.equal(parsePushTokenInput(input), null, JSON.stringify(input));
  }
});

test("storing a token retires the device's old token and binds the caller id", async () => {
  const { storePushToken } = loadRoute().route;
  const db = fakeSql();
  await storePushToken(db, USER, { expoPushToken: TOKEN, deviceId: DEVICE });
  assert.equal(db.calls.length, 1);
  const { text, values } = db.calls[0];
  assert.match(text, /update push_tokens/);
  assert.match(text, /set revoked_at = now\(\)/);
  assert.match(text, /expo_push_token <>/); // rotation: only the old token is retired
  assert.match(text, /insert into push_tokens \(user_id, device_id, expo_push_token\)/);
  assert.match(text, /on conflict \(expo_push_token\) do update set/);
  assert.deepEqual(values, [USER, DEVICE, TOKEN, USER, DEVICE, TOKEN]);
});

test("route refuses unauthenticated, invalid, and oversized bodies without writing", async () => {
  const denied = loadRoute({ currentUserId: async () => null });
  const deniedRes = await denied.route.POST(post({ expo_push_token: TOKEN, device_id: DEVICE }));
  assert.equal(deniedRes.status, 401);
  assert.equal(denied.sql.calls.length, 0);

  const bad = loadRoute();
  for (const body of [{}, "not json", { expo_push_token: "e".repeat(600), device_id: DEVICE }]) {
    const res = await bad.route.POST(post(body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(bad.sql.calls.length, 0);

  const huge = loadRoute();
  const hugeRes = await huge.route.POST(post("x".repeat(5000)));
  assert.equal(hugeRes.status, 413);
  assert.equal(huge.sql.calls.length, 0);
});

test("route stores a valid registration and answers ok", async () => {
  const { route, sql } = loadRoute();
  const res = await route.POST(post({ expo_push_token: TOKEN, device_id: DEVICE }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(sql.calls.length, 1);
  assert.deepEqual(sql.calls[0].values, [USER, DEVICE, TOKEN, USER, DEVICE, TOKEN]);
});

test("native registration is wired to sign-in but guarded for web and Expo Go", () => {
  const push = readFileSync("mobile/lib/push.ts", "utf8");
  const layout = readFileSync("mobile/app/_layout.tsx", "utf8");

  assert.match(layout, /import \{ registerPushToken \} from "\.\.\/lib\/push"/);
  assert.match(layout, /<PushRegistration \/>/);
  assert.match(layout, /const \{ token \} = useAuth\(\)/);
  assert.match(layout, /useRef<string \| null>/);
  assert.match(layout, /registerPushToken\(token\)/);
  assert.match(push, /Platform\.OS !== "web"/);
  assert.match(push, /appOwnership !== "expo"/);
  assert.match(push, /Constants\.expoGoConfig === null/); // dev builds still register
  assert.match(push, /getExpoPushTokenAsync/);
  assert.match(push, /api\/me\/push-token/);
  assert.match(push, /expo_push_token: expoToken/);
  assert.match(push, /device_id: await getDeviceId\(\)/);
  assert.match(push, /Authorization: `Bearer \$\{apiToken\}`/);
  assert.match(push, /Alert\.alert/);
  assert.match(push, /catch \{/); // never fatal
  assert.doesNotMatch(push, /exp\.host|expo\.dev\/v2\/projects\/.*\/send/); // no sending yet

  const mobilePkg = JSON.parse(readFileSync("mobile/package.json", "utf8"));
  assert.ok(mobilePkg.dependencies["expo-notifications"], "dependency declared for native builds");
  const appConfig = JSON.parse(readFileSync("mobile/app.json", "utf8"));
  assert.ok(appConfig.expo.plugins.includes("expo-notifications"), "config plugin declared");
});

test("migration is idempotent, stores device + token, and tracks rotation", () => {
  const sql = readFileSync("db/migrations/013_push_tokens.sql", "utf8");
  assert.match(sql, /create table if not exists push_tokens/);
  for (const column of ["user_id", "device_id", "expo_push_token", "created_at", "updated_at", "revoked_at"]) {
    assert.match(sql, new RegExp(column), column);
  }
  assert.match(sql, /expo_push_token text not null unique/);
  assert.match(sql, /create index if not exists/);
  assert.match(sql, /references users\(id\) on delete cascade/);
  assert.match(sql, /JIMMY'S APPROVAL/i); // never applied automatically
});
