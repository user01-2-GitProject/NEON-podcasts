#!/usr/bin/env node
// LLM-powered NEON live-podcast agent using Anthropic Claude. Dependency-free: Node 20+.
//
//   NEON_BASE_URL=https://neon-podcasts.vercel.app \
//   NEON_TOKEN=npt_<64 hex>                        \
//   NEON_SESSION_ID=<session uuid>                  \
//   ANTHROPIC_API_KEY=sk-ant-...                    \
//   node scripts/live-agent-anthropic.mjs [--once]
//
// The agent joins a live session, reads the transcript, and uses Claude to
// generate thoughtful responses. Replace SYSTEM_PROMPT to change its personality.

import { pathToFileURL } from "node:url";
import { createClient, latestSeq, LiveApiError } from "./live-agent-example.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^npt_[0-9a-f]{64}$/i;

const SYSTEM_PROMPT = `You are an AI co-host on a live podcast. You're articulate, curious, and concise.
- Keep responses under 280 characters so they read well in a live chat.
- React to what was just said — agree, push back, ask a follow-up, or add a fact.
- Never repeat the previous speaker's words back to them verbatim.
- If multiple turns happened, respond to the most interesting one.
- Be conversational, not formal. Use the speaker's name naturally.
- If you have nothing meaningful to add, reply with just "..." to stay quiet.`;

export function readConfig(env = process.env, argv = process.argv.slice(2)) {
  const baseUrl = (env.NEON_BASE_URL || "").replace(/\/+$/, "");
  const token = env.NEON_TOKEN || "";
  const sessionId = env.NEON_SESSION_ID || "";
  const anthropicKey = env.ANTHROPIC_API_KEY || "";
  const problems = [];
  if (!/^https?:\/\//.test(baseUrl)) problems.push("NEON_BASE_URL must be an http(s) URL");
  if (!TOKEN_RE.test(token)) problems.push("NEON_TOKEN must be an npt_<64 hex> agent token");
  if (!UUID_RE.test(sessionId)) problems.push("NEON_SESSION_ID must be a live session uuid");
  if (!anthropicKey) problems.push("ANTHROPIC_API_KEY is required");
  if (problems.length) throw new Error(problems.join("\n"));
  const after = env.NEON_AFTER === undefined ? null : Number(env.NEON_AFTER);
  if (after !== null && (!Number.isSafeInteger(after) || after < 0)) throw new Error("NEON_AFTER must be a non-negative integer");
  return {
    baseUrl,
    token,
    sessionId,
    anthropicKey,
    displayName: (env.NEON_AGENT_NAME || "AI Co-host").slice(0, 40),
    model: env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    replyToAgents: env.NEON_REPLY_TO_AGENTS !== "false",
    pollMs: Math.max(1000, Number(env.NEON_POLL_MS) || 3000),
    heartbeatMs: 20_000,
    after,
    once: argv.includes("--once"),
    systemPrompt: env.NEON_SYSTEM_PROMPT || SYSTEM_PROMPT,
  };
}

async function askLLM(config, transcript, me) {
  const messages = transcript.map((t) => ({
    role: t.participant.id === me.id ? "assistant" : "user",
    content: `[${t.participant.display_name} (${t.participant.kind}/${t.participant.role})]: ${t.text}`,
  }));
  // Anthropic requires alternating user/assistant; merge consecutive same-role messages
  const merged = [];
  for (const m of messages) {
    if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
      merged[merged.length - 1].content += "\n" + m.content;
    } else {
      merged.push({ ...m });
    }
  }
  // Ensure the conversation starts with a user message
  if (merged.length === 0 || merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "[System]: The live session is active. Contribute to the conversation." });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.model, system: config.systemPrompt, messages: merged, max_tokens: 200 }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  return text.trim();
}

function replyKind(me) {
  return me.role === "listener" ? "chat" : "speech";
}

function shouldReply(turns, me, { replyToAgents = true } = {}) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.kind === "system" || t.participant.id === me.id) continue;
    if (t.participant.kind === "agent" && !replyToAgents) continue;
    return true;
  }
  return false;
}

export async function pollOnce(client, state, config) {
  const turns = await client.listTurns(state.after);
  if (turns.length) state.after = turns[turns.length - 1].seq;
  if (!shouldReply(turns, state.me, { replyToAgents: config.replyToAgents })) {
    return { turns, replied: null };
  }
  state.context.push(...turns);
  if (state.context.length > 30) state.context = state.context.slice(-20);

  const text = await askLLM(config, state.context, state.me);
  if (!text || text === "...") return { turns, replied: null };
  try {
    const posted = await client.postTurn(replyKind(state.me), text.slice(0, 4000));
    return { turns, replied: { to: turns[turns.length - 1].seq, seq: posted.seq, text } };
  } catch (err) {
    if (err instanceof LiveApiError && err.status === 429) return { turns, replied: null, rateLimited: true };
    throw err;
  }
}

export async function run(config, { fetch: f = globalThis.fetch, log = console.log, sleep, signal } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const client = createClient({ ...config, fetch: f });
  const me = await client.join(config.displayName);
  log(`joined as ${me.display_name} (${me.kind}, ${me.role})`);
  const state = { me, after: config.after ?? (config.once ? 0 : await latestSeq(client)), context: [] };

  if (config.once) {
    try {
      const { turns, replied } = await pollOnce(client, state, config);
      log(`saw ${turns.length} turn(s)${replied ? `, replied as #${replied.seq}: ${replied.text}` : ""}`);
      return state;
    } finally {
      await client.leave().catch(() => {});
    }
  }

  const beat = setInterval(() => client.heartbeat().catch((err) => log(`heartbeat failed: ${err.message}`)), config.heartbeatMs);
  try {
    while (!signal?.aborted) {
      try {
        const { replied, rateLimited } = await pollOnce(client, state, config);
        if (replied) log(`replied to #${replied.to}: ${replied.text}`);
        if (rateLimited) log("rate limited, skipping this cycle");
      } catch (err) {
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
