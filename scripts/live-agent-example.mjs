#!/usr/bin/env node
// Minimal external agent for a NEON live podcast session. Dependency-free:
// Node 20+ (global fetch). See docs/live-agents.md.
//
//   NEON_BASE_URL=https://neon.example \
//   NEON_TOKEN=npt_<64 hex>            \   # an agent:<name> token, read_write scope
//   NEON_SESSION_ID=<session uuid>     \
//   node scripts/live-agent-example.mjs [--once]
//
// Flow: join → heartbeat every 20 s → poll GET turns?after=<seq> → reply to the
// newest turn from someone else → leave on Ctrl-C (or after one cycle with --once).
// Replace replyFor() with your agent's brain.

import { pathToFileURL } from "node:url";

const TOKEN_RE = /^npt_[0-9a-f]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An HTTP error from the NEON API, carrying the status and the server's message.
export class LiveApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Reads and validates settings from the environment and argv.
export function readConfig(env = process.env, argv = process.argv.slice(2)) {
  const baseUrl = (env.NEON_BASE_URL || "").replace(/\/+$/, "");
  const token = env.NEON_TOKEN || "";
  const sessionId = env.NEON_SESSION_ID || "";
  const problems = [];
  if (!/^https?:\/\//.test(baseUrl)) problems.push("NEON_BASE_URL must be an http(s) URL");
  if (!TOKEN_RE.test(token)) problems.push("NEON_TOKEN must be an npt_<64 hex> token (Settings → Devices → Create agent token)");
  if (!UUID_RE.test(sessionId)) problems.push("NEON_SESSION_ID must be a live session id (uuid)");
  if (problems.length) throw new Error(problems.join("\n"));
  const after = env.NEON_AFTER === undefined ? null : Number(env.NEON_AFTER);
  if (after !== null && (!Number.isSafeInteger(after) || after < 0)) throw new Error("NEON_AFTER must be a non-negative integer");
  return {
    baseUrl,
    token,
    sessionId,
    displayName: (env.NEON_AGENT_NAME || "NEON example agent").slice(0, 40),
    replyToAgents: env.NEON_REPLY_TO_AGENTS !== "false",
    pollMs: Math.max(1000, Number(env.NEON_POLL_MS) || 3000),
    heartbeatMs: 20_000,
    after,
    once: argv.includes("--once"),
  };
}

// Thin client for the live endpoints. Every request carries the bearer token.
export function createClient({ baseUrl, token, sessionId, fetch = globalThis.fetch }) {
  const base = `${baseUrl}/api/live/${sessionId}`;
  async function request(path, init = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LiveApiError(res.status, data.error || `HTTP ${res.status}`);
    return data;
  }
  return {
    join: (displayName) =>
      request("/join", { method: "POST", body: JSON.stringify({ display_name: displayName }) }).then((d) => d.participant),
    heartbeat: () => request("/heartbeat", { method: "POST" }),
    leave: () => request("/leave", { method: "POST" }),
    listTurns: (after) => request(`/turns?after=${after}`).then((d) => d.turns || []),
    postTurn: (kind, text) => request("/turns", { method: "POST", body: JSON.stringify({ kind, text }) }),
  };
}

// Decides what to say about a turn, or null to stay quiet. Never replies to
// itself or to system turns; set NEON_REPLY_TO_AGENTS=false to answer humans only
// (two example agents in one room will otherwise keep answering each other,
// throttled by the poll interval and the server's 3 s per-turn limit).
export function replyFor(turn, me, { replyToAgents = true } = {}) {
  if (turn.kind === "system" || turn.participant.id === me.id) return null;
  if (turn.participant.kind === "agent" && !replyToAgents) return null;
  const excerpt = turn.text.length > 80 ? `${turn.text.slice(0, 77)}...` : turn.text;
  return `Thanks, ${turn.participant.display_name}! I heard: "${excerpt}"`;
}

// Listeners may only chat; the host and guests on stage may speak.
export function replyKind(me) {
  return me.role === "listener" ? "chat" : "speech";
}

// Pages through the existing transcript and returns its last seq, so a fresh
// agent answers what's said from now on instead of the whole history.
export async function latestSeq(client, after = 0) {
  let seq = after;
  for (;;) {
    const turns = await client.listTurns(seq);
    if (turns.length === 0) return seq;
    seq = turns[turns.length - 1].seq;
  }
}

// One cycle: fetch turns after state.after, advance the cursor, and reply to
// the newest turn worth answering (at most one post per cycle).
export async function pollOnce(client, state, opts = {}) {
  const turns = await client.listTurns(state.after);
  if (turns.length) state.after = turns[turns.length - 1].seq;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const text = replyFor(turns[i], state.me, opts);
    if (text === null) continue;
    try {
      const posted = await client.postTurn(replyKind(state.me), text);
      return { turns, replied: { to: turns[i].seq, seq: posted.seq, text } };
    } catch (err) {
      // Rate limited (429): skip this reply rather than crash; the next cycle continues.
      if (err instanceof LiveApiError && err.status === 429) return { turns, replied: null, rateLimited: true };
      throw err;
    }
  }
  return { turns, replied: null };
}

// Joins and runs until stopped (or for one cycle with --once), then leaves.
export async function run(config, { fetch = globalThis.fetch, log = console.log, sleep, signal } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const client = createClient({ ...config, fetch });
  const me = await client.join(config.displayName);
  log(`joined as ${me.display_name} (${me.kind}, ${me.role})`);
  const state = { me, after: config.after ?? (config.once ? 0 : await latestSeq(client)) };
  const opts = { replyToAgents: config.replyToAgents };

  if (config.once) {
    try {
      const { turns, replied } = await pollOnce(client, state, opts);
      log(`saw ${turns.length} new turn(s)${replied ? `, replied to #${replied.to} as #${replied.seq}` : ""}`);
      return state;
    } finally {
      await client.leave().catch(() => {});
    }
  }

  // Heartbeats keep us from showing as away (after 60 s of silence).
  const beat = setInterval(() => client.heartbeat().catch((err) => log(`heartbeat failed: ${err.message}`)), config.heartbeatMs);
  try {
    while (!signal?.aborted) {
      try {
        const { replied } = await pollOnce(client, state, opts);
        if (replied) log(`replied to #${replied.to}: ${replied.text}`);
      } catch (err) {
        // The session ended or we were removed: stop. Anything else: log and retry.
        if (err instanceof LiveApiError && [401, 403, 404, 409].includes(err.status)) {
          log(`stopping: ${err.message} (HTTP ${err.status})`);
          break;
        }
        log(`poll failed, retrying: ${err.message}`);
      }
      await wait(config.pollMs);
    }
  } finally {
    clearInterval(beat);
    await client.leave().catch(() => {});
    log("left the session");
  }
  return state;
}

async function main() {
  let config;
  try {
    config = readConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  try {
    await run(config, { signal: controller.signal });
  } catch (err) {
    console.error(err instanceof LiveApiError ? `NEON API error (HTTP ${err.status}): ${err.message}` : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
