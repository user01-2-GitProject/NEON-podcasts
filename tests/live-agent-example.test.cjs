const { test } = require("node:test");
const assert = require("node:assert/strict");

const BASE = "https://neon.test";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "npt_" + "ab".repeat(32);
const ME = { id: "p-me", display_name: "Bot", kind: "agent", role: "listener", muted: false, away: false };

const turn = (seq, participant, text = `line ${seq}`, kind = "speech") => ({
  seq,
  kind,
  text,
  created_at: "2026-11-24T10:00:00.000Z",
  participant,
});
const host = { id: "p-host", display_name: "Jimmy", kind: "human", role: "host" };
const otherAgent = { id: "p-other", display_name: "Other bot", kind: "agent", role: "listener" };

// A fake fetch: routes "METHOD /path" to a handler and records every request.
function mockFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const { pathname, search } = new URL(url);
    const method = init.method || "GET";
    calls.push({ method, pathname, search, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[`${method} ${pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: "not mocked" }), { status: 500 });
    const [status, body] = handler(new URLSearchParams(search), calls.length);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  fetch.calls = calls;
  return fetch;
}

const path = (suffix) => `/api/live/${SESSION}${suffix}`;
const config = (extra = {}) => ({
  baseUrl: BASE,
  token: TOKEN,
  sessionId: SESSION,
  displayName: "Bot",
  replyToAgents: true,
  pollMs: 1000,
  heartbeatMs: 20000,
  after: null,
  once: true,
  ...extra,
});

test("--once joins, polls from the requested seq, replies with the bearer header, then leaves", async () => {
  const { run } = await import("../scripts/live-agent-example.mjs");
  const fetch = mockFetch({
    [`POST ${path("/join")}`]: () => [200, { participant: ME }],
    [`GET ${path("/turns")}`]: () => [200, { turns: [turn(5, host, "Welcome to the show"), turn(6, ME, "my own line")] }],
    [`POST ${path("/turns")}`]: () => [201, { seq: 7 }],
    [`POST ${path("/leave")}`]: () => [200, { ok: true }],
  });
  const state = await run(config({ after: 4 }), { fetch, log: () => {} });

  assert.deepEqual(
    fetch.calls.map((c) => `${c.method} ${c.pathname}${c.search}`),
    [`POST ${path("/join")}`, `GET ${path("/turns")}?after=4`, `POST ${path("/turns")}`, `POST ${path("/leave")}`],
  );
  for (const call of fetch.calls) assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(fetch.calls[0].body, { display_name: "Bot" });
  // replies to the host's turn (not its own), as chat because it's a listener
  assert.deepEqual(fetch.calls[2].body, { kind: "chat", text: 'Thanks, Jimmy! I heard: "Welcome to the show"' });
  assert.equal(state.after, 6);
});

test("pollOnce advances the cursor and asks for turns after the last seen seq", async () => {
  const { createClient, pollOnce } = await import("../scripts/live-agent-example.mjs");
  const pages = [[turn(10, host)], []];
  const fetch = mockFetch({
    [`GET ${path("/turns")}`]: () => [200, { turns: pages.shift() }],
    [`POST ${path("/turns")}`]: () => [201, { seq: 11 }],
  });
  const client = createClient({ baseUrl: BASE, token: TOKEN, sessionId: SESSION, fetch });
  const state = { me: { ...ME, role: "guest" }, after: 9 };

  const first = await pollOnce(client, state);
  assert.equal(first.replied.to, 10);
  assert.equal(fetch.calls[1].body.kind, "speech"); // on stage → speech
  const second = await pollOnce(client, state);
  assert.equal(second.replied, null);
  assert.deepEqual(fetch.calls.filter((c) => c.method === "GET").map((c) => c.search), ["?after=9", "?after=10"]);
});

test("a fresh agent skips existing history before replying", async () => {
  const { createClient, latestSeq } = await import("../scripts/live-agent-example.mjs");
  const fetch = mockFetch({
    [`GET ${path("/turns")}`]: (query) =>
      query.get("after") === "0" ? [200, { turns: [turn(1, host), turn(2, host)] }] : [200, { turns: [] }],
  });
  const client = createClient({ baseUrl: BASE, token: TOKEN, sessionId: SESSION, fetch });
  assert.equal(await latestSeq(client), 2);
  assert.deepEqual(fetch.calls.map((c) => c.search), ["?after=0", "?after=2"]);
  assert.equal(fetch.calls.some((c) => c.method === "POST"), false);
});

test("reply choice skips itself, system turns, and (optionally) other agents", async () => {
  const { replyFor } = await import("../scripts/live-agent-example.mjs");
  assert.equal(replyFor(turn(1, ME), ME), null);
  assert.equal(replyFor(turn(1, host, "x", "system"), ME), null);
  assert.match(replyFor(turn(1, otherAgent, "hi"), ME), /Other bot/);
  assert.equal(replyFor(turn(1, otherAgent, "hi"), ME, { replyToAgents: false }), null);
  assert.match(replyFor(turn(1, host, "y".repeat(200)), ME), /\.\.\."$/);
});

test("a 429 on reply is skipped; a closed session stops the loop and leaves", async () => {
  const { createClient, pollOnce, run, LiveApiError } = await import("../scripts/live-agent-example.mjs");
  const limited = mockFetch({
    [`GET ${path("/turns")}`]: () => [200, { turns: [turn(3, host)] }],
    [`POST ${path("/turns")}`]: () => [429, { error: "wait 3 seconds between turns" }],
  });
  const client = createClient({ baseUrl: BASE, token: TOKEN, sessionId: SESSION, fetch: limited });
  const result = await pollOnce(client, { me: ME, after: 2 });
  assert.equal(result.rateLimited, true);

  let polls = 0;
  const ended = mockFetch({
    [`POST ${path("/join")}`]: () => [200, { participant: ME }],
    // first poll is fine (nothing new); the host then ends the session
    [`GET ${path("/turns")}`]: () => (++polls === 1 ? [200, { turns: [] }] : [409, { error: "session is not live" }]),
    [`POST ${path("/leave")}`]: () => [200, { ok: true }],
  });
  const logs = [];
  await run(config({ once: false, after: 0 }), { fetch: ended, log: (line) => logs.push(line), sleep: async () => {} });
  assert.equal(polls, 2);
  assert.equal(ended.calls.at(-1).pathname, path("/leave"));
  assert.ok(logs.some((line) => /stopping: session is not live \(HTTP 409\)/.test(line)));

  const refused = mockFetch({ [`POST ${path("/join")}`]: () => [403, { error: "you were removed from this session" }] });
  await assert.rejects(run(config(), { fetch: refused, log: () => {} }), (err) => err instanceof LiveApiError && err.status === 403);
});

test("config requires an npt_ token, an http(s) base URL and a session uuid", async () => {
  const { readConfig } = await import("../scripts/live-agent-example.mjs");
  const env = { NEON_BASE_URL: `${BASE}/`, NEON_TOKEN: TOKEN, NEON_SESSION_ID: SESSION };
  const ok = readConfig(env, ["--once"]);
  assert.equal(ok.baseUrl, BASE);
  assert.equal(ok.once, true);
  assert.equal(ok.after, null);
  assert.equal(readConfig({ ...env, NEON_AFTER: "12" }, []).after, 12);
  assert.throws(() => readConfig({ ...env, NEON_TOKEN: "secret" }, []), /NEON_TOKEN/);
  assert.throws(() => readConfig({ ...env, NEON_BASE_URL: "neon.test" }, []), /NEON_BASE_URL/);
  assert.throws(() => readConfig({ ...env, NEON_SESSION_ID: "abc" }, []), /NEON_SESSION_ID/);
  assert.throws(() => readConfig({ ...env, NEON_AFTER: "-3" }, []), /NEON_AFTER/);
});
