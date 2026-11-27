#!/usr/bin/env node
// Council leader for NEON fact-checking. Dependency-free: Node 20+ (global
// fetch). The server builds the prompts; this script only fans them out,
// collects the answers, runs the Lead + rebuttal rounds, and POSTs the result.
//
//   NEON_BASE_URL=https://neon.example \
//   NEON_TOKEN=npt_<64 hex>            \   # read_write token from Settings -> Devices
//   CODEX_CMD=codex LEAD_CMD=claude     \
//   MUSE_INPUT_DIR=/path/in MUSE_OUTPUT_DIR=/path/out \
//   node scripts/fact-check-council.mjs [--once]
//
// Quickdraw = Codex (`codex exec --output-schema ... -o ... <prompt>`).
// Scholar = Muse drop folder (write fact-check-<id>.md, wait for .json).
// Lead = Claude (`claude -p --output-format json <prompt>`).
// SIGINT/SIGTERM finish the current item, then exit cleanly.

import { execFile as nodeExecFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(nodeExecFile);
const TOKEN_RE = /^npt_[0-9a-f]{64}$/i;
const FACT_CHECK_KINDS = ["wrong", "unsupported", "outdated", "missing-context"];
const PERSONAS = ["quickdraw", "scholar", "lead"];
const NOTE_SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: FACT_CHECK_KINDS },
          message: { type: "string" },
          excerpt: { type: "string" },
        },
        required: ["kind", "message"],
      },
    },
    added_sources: { type: "array", items: { type: "string" } },
  },
  required: ["notes"],
};

export class CouncilApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Read and validate environment settings. Never echoes the token. */
export function readConfig(env = process.env, argv = process.argv.slice(2)) {
  const baseUrl = (env.NEON_BASE_URL || "").replace(/\/+$/, "");
  const token = env.NEON_TOKEN || "";
  const problems = [];
  if (!/^https?:\/\//.test(baseUrl)) problems.push("NEON_BASE_URL must be an http(s) URL");
  if (!TOKEN_RE.test(token)) problems.push("NEON_TOKEN must be an npt_<64 hex> token (Settings -> Devices)");
  if (!env.MUSE_INPUT_DIR) problems.push("MUSE_INPUT_DIR is required (Scholar drop folder)");
  if (!env.MUSE_OUTPUT_DIR) problems.push("MUSE_OUTPUT_DIR is required (Scholar result folder)");
  const qwenUrl = (env.QWEN_URL || "").replace(/\/+$/, "");
  if (qwenUrl && !/^https?:\/\//.test(qwenUrl)) problems.push("QWEN_URL must be an http(s) URL (Ollama base URL)");
  if (problems.length) throw new Error(problems.join("\n"));
  const pollMs = Number(env.POLL_INTERVAL_MS) || 120000;
  const museTimeoutMs = Number(env.MUSE_TIMEOUT_MS) || 1800000;
  const qwenTimeoutMs = Number(env.QWEN_TIMEOUT_MS) || 60000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 1000) throw new Error("POLL_INTERVAL_MS must be >= 1000");
  if (!Number.isSafeInteger(museTimeoutMs) || museTimeoutMs < 1000) throw new Error("MUSE_TIMEOUT_MS must be >= 1000");
  if (!Number.isSafeInteger(qwenTimeoutMs) || qwenTimeoutMs < 1000) throw new Error("QWEN_TIMEOUT_MS must be >= 1000");
  return {
    baseUrl,
    token,
    codexCmd: env.CODEX_CMD || "codex",
    leadCmd: env.LEAD_CMD || "claude",
    museInputDir: env.MUSE_INPUT_DIR,
    museOutputDir: env.MUSE_OUTPUT_DIR,
    museTimeoutMs,
    qwenUrl,
    qwenModel: env.QWEN_MODEL || "qwen3.5-9b-fc",
    qwenTimeoutMs,
    qwenDisagreementLog: env.QWEN_DISAGREEMENT_LOG || join(process.cwd(), "qwen-disagreements.jsonl"),
    pollMs,
    once: argv.includes("--once") || env.ONCE === "1",
  };
}

/** Tiny bearer client for the two council endpoints. */
export function createClient({ baseUrl, token, fetch = globalThis.fetch }) {
  async function request(path, init = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new CouncilApiError(res.status, data.error || `HTTP ${res.status}`);
    return data;
  }
  return {
    pending: () => request("/api/council/pending").then((d) => d.items || []),
    submit: (episodeId, body) => request(`/api/episodes/${encodeURIComponent(episodeId)}/fact-check`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  };
}

/** Pull a JSON object out of fences or surrounding prose, including Claude envelopes. */
export function extractJson(text) {
  let raw = String(text || "").trim();
  for (let i = 0; i < 3; i += 1) {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    let candidate = fence ? fence[1].trim() : raw;
    if (!candidate.startsWith("{")) {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start === -1 || end <= start) return null;
      candidate = candidate.slice(start, end + 1);
    }
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return null;
    }
    if (parsed && typeof parsed === "object" && typeof parsed.result === "string" && parsed.result.trim() !== raw) {
      raw = parsed.result;
      continue;
    }
    return parsed;
  }
  return null;
}

function clean(value, max) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function normalizeNote(value) {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind;
  const message = clean(value.message, 240);
  if (!FACT_CHECK_KINDS.includes(kind) || !message) return null;
  const excerpt = clean(value.excerpt, 160);
  return { kind, message, ...(excerpt ? { excerpt } : {}) };
}

/** Parse a Quickdraw/Scholar JSON result into council notes. */
export function parseMemberResult(text) {
  const parsed = extractJson(text);
  const rawNotes = parsed && Array.isArray(parsed.notes) ? parsed.notes : [];
  const notes = [];
  const seen = new Set();
  for (const item of rawNotes) {
    const note = normalizeNote(item);
    if (!note) continue;
    const key = `${note.kind}:${(note.excerpt || note.message).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(note);
  }
  const addedSources = Array.isArray(parsed?.added_sources)
    ? parsed.added_sources.map((s) => clean(s, 500)).filter(Boolean)
    : [];
  return { notes, added_sources: addedSources };
}

function normalizeFlag(value, personas) {
  const note = normalizeNote(value);
  if (!note) return null;
  const persona = value.persona;
  if (!personas.includes(persona)) return null;
  return { ...note, persona };
}

/** Parse the Lead's JSON result: upheld flags, dismissals, tags, accepted sources. */
export function parseLeadResult(text, personas = ["quickdraw", "scholar"]) {
  const parsed = extractJson(text) || {};
  const upheld = [];
  for (const item of Array.isArray(parsed.upheld) ? parsed.upheld : []) {
    const flag = normalizeFlag(item, personas);
    if (flag) upheld.push(flag);
  }
  const dismissed = [];
  for (const item of Array.isArray(parsed.dismissed) ? parsed.dismissed : []) {
    const flag = normalizeFlag(item?.flag, personas);
    const reason = clean(item?.reason, 500);
    if (!flag || !reason) continue;
    dismissed.push({ flag, reason, flagger_agrees: item?.flagger_agrees === true });
  }
  const tags = [...new Set((Array.isArray(parsed.tags) ? parsed.tags : [])
    .map((t) => clean(t, 32).toLowerCase())
    .filter(Boolean))].slice(0, 16);
  const accepted = Array.isArray(parsed.accepted_sources)
    ? parsed.accepted_sources.map((s) => clean(s, 500)).filter(Boolean)
    : [];
  return { upheld, dismissed, tags, accepted_sources: accepted };
}

/** Parse a rebuttal answer. Only an explicit `true` counts as agreement. */
export function parseRebuttal(text) {
  const parsed = extractJson(text);
  if (parsed && typeof parsed.agrees === "boolean") return parsed.agrees;
  return /\bagrees\s*[:=]?\s*true\b|\byes\b/i.test(String(text || ""));
}

/** The server re-checks this rule; keep it byte-for-byte equivalent. */
export function councilVerdict({ upheld = [], dismissed = [] }) {
  if (upheld.length > 0) return "fail";
  return dismissed.some((d) => d.flagger_agrees === false) ? "fail" : "pass";
}

/** Compose the submission POSTed to /api/episodes/:id/fact-check. */
export function buildSubmission(item, memberResults, lead, rebuttals = []) {
  const members = memberResults.map((r) => ({ persona: r.persona, model: r.model, notes: r.notes }));
  const dismissed = lead.dismissed.map((d, i) => ({ ...d, flagger_agrees: rebuttals[i] === true }));
  const allSources = memberResults.flatMap((r) =>
    (r.added_sources || []).map((url) => ({ url, by: r.persona, accepted: lead.accepted_sources.includes(url) })),
  );
  const submission = {
    members,
    upheld: lead.upheld,
    dismissed,
    verdict: councilVerdict({ upheld: lead.upheld, dismissed }),
    tags: lead.tags,
    added_sources: allSources,
  };
  return submission;
}

/** Prompt text sent to a member: the server-built system prompt + user prompt. */
export function memberPrompt(item, persona) {
  const prompt = item.prompts?.[persona];
  if (!prompt || typeof prompt.system !== "string" || typeof prompt.user !== "string") {
    throw new Error(`pending item is missing the ${persona} prompt`);
  }
  return `${prompt.system}\n\n${prompt.user}`;
}

export function leadPrompt(item, memberResults) {
  const reports = memberResults
    .map((r) => `${r.persona.toUpperCase()} (${r.model}):\n${JSON.stringify(r.notes, null, 2) || "[]"}`)
    .join("\n\n");
  return [
    "You are the Lead fact-checker. Decide which flags are real.",
    "A script passes only when every checker agrees it is accurate.",
    "Return ONLY a JSON object:",
    '{"upheld":[{"kind":"wrong","message":"...","excerpt":"...","persona":"quickdraw"}],',
    '"dismissed":[{"flag":{...same shape...},"reason":"why it is a false positive"}],',
    '"tags":["topic:finance","format:interview"],"accepted_sources":["https://..."]}',
    "Choose one topic:<slug> and one format:<slug> tag for the script.",
    "Put every flag from the members into upheld or dismissed; never silently drop one.",
    "If you dismiss a flag, write a short reason the original flagger can respond to.",
    "",
    `EPISODE: ${item.episode_id}`,
    `TITLE: ${item.title || ""}`,
    "",
    reports,
  ].join("\n");
}

export function rebuttalPrompt(flag, reason) {
  return [
    `You flagged this: ${JSON.stringify(flag)}`,
    `The Lead says it is a false positive: ${reason}`,
    "After reading that reason, do you still disagree? Return ONLY JSON: {\"agrees\":true|false}.",
    "agrees=true means you accept the Lead's reasoning; agrees=false means the flag stands.",
  ].join("\n");
}

export function codexArgs(schemaPath, outPath, prompt) {
  return ["exec", "--skip-git-repo-check", "--output-schema", schemaPath, "-o", outPath, prompt];
}

export function leadArgs(prompt) {
  return ["-p", "--output-format", "json", prompt];
}

function runCommand(cmd, args, execFile = execFileAsync, timeout = 0) {
  return execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout }).then((r) => String(r.stdout || ""));
}

async function runQuickdraw(item, config, deps) {
  const dir = deps.tmpDir || (await mkdtemp(join(tmpdir(), "fc-council-")));
  if (deps.mkdir) await deps.mkdir(dir, { recursive: true });
  const schemaPath = join(dir, `fc-schema-${item.episode_id}.json`);
  const outPath = join(dir, `fc-quickdraw-${item.episode_id}.json`);
  await deps.writeFile(schemaPath, JSON.stringify(NOTE_SCHEMA));
  await deps.unlink(outPath).catch(() => {});
  const stdout = await runCommand(
    config.codexCmd,
    codexArgs(schemaPath, outPath, memberPrompt(item, "quickdraw")),
    deps.execFile,
  );
  const text = (await deps.readFile(outPath, "utf8").catch(() => "")) || stdout;
  const { notes, added_sources } = parseMemberResult(text);
  return { persona: "quickdraw", model: config.codexCmd, notes, added_sources };
}

function musePaths(config, episodeId, suffix = "") {
  const base = `fact-check-${episodeId}${suffix}`;
  return {
    input: join(config.museInputDir, `${base}.md`),
    output: join(config.museOutputDir, `${base}.json`),
  };
}

async function waitForFile(path, timeoutMs, deps) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await deps.readFile(path, "utf8").catch(() => null);
    if (text !== null && text.trim()) return text;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await deps.sleep(deps.watchIntervalMs || 1000);
  }
}

async function runScholar(item, config, deps) {
  const { input, output } = musePaths(config, item.episode_id);
  await deps.mkdir(config.museInputDir, { recursive: true });
  await deps.mkdir(config.museOutputDir, { recursive: true });
  await deps.unlink(output).catch(() => {});
  await deps.writeFile(input, memberPrompt(item, "scholar"));
  const text = await waitForFile(output, config.museTimeoutMs, deps);
  const { notes, added_sources } = parseMemberResult(text);
  await deps.unlink(output).catch(() => {});
  await deps.unlink(input).catch(() => {});
  return { persona: "scholar", model: "muse", notes, added_sources };
}

async function runLead(item, members, config, deps) {
  const stdout = await runCommand(config.leadCmd, leadArgs(leadPrompt(item, members)), deps.execFile);
  return parseLeadResult(stdout, members.map((m) => m.persona));
}

/** Optional fourth voter: a locally served Qwen model (Ollama /api/chat). */
export async function runQwen(item, config, deps) {
  if (!config.qwenUrl) return null;
  const prompt = item.prompts?.qwen;
  if (!prompt || typeof prompt.system !== "string" || typeof prompt.user !== "string") {
    throw new Error("pending item is missing the qwen prompt");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.qwenTimeoutMs);
  try {
    const res = await deps.fetch(`${config.qwenUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.qwenModel,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Qwen HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.message?.content || data?.response || JSON.stringify(data);
    const { notes, added_sources } = parseMemberResult(text);
    return { persona: "qwen", model: config.qwenModel, notes, added_sources };
  } finally {
    clearTimeout(timer);
  }
}

async function runRebuttal(config, deps, flag, reason, index) {
  if (flag.persona === "qwen") {
    const res = await deps.fetch(`${config.qwenUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.qwenModel,
        stream: false,
        format: "json",
        messages: [{ role: "user", content: rebuttalPrompt(flag, reason) }],
      }),
    });
    if (!res.ok) throw new Error(`Qwen rebuttal HTTP ${res.status}`);
    const data = await res.json();
    return parseRebuttal(data?.message?.content || data?.response || JSON.stringify(data));
  }
  const prompt = rebuttalPrompt(flag, reason);
  if (flag.persona === "quickdraw") {
    const dir = deps.tmpDir || (await mkdtemp(join(tmpdir(), "fc-council-")));
    const schemaPath = join(dir, `fc-rebuttal-schema-${index}.json`);
    const outPath = join(dir, `fc-rebuttal-${index}.json`);
    await deps.writeFile(schemaPath, JSON.stringify({ type: "object", properties: { agrees: { type: "boolean" } }, required: ["agrees"] }));
    await deps.unlink(outPath).catch(() => {});
    const stdout = await runCommand(config.codexCmd, codexArgs(schemaPath, outPath, prompt), deps.execFile);
    return parseRebuttal((await deps.readFile(outPath, "utf8").catch(() => "")) || stdout);
  }
  const target = musePaths(config, deps.currentEpisodeId || "rebuttal", `-rebuttal-${index}`);
  await deps.mkdir(config.museInputDir, { recursive: true });
  await deps.mkdir(config.museOutputDir, { recursive: true });
  await deps.unlink(target.output).catch(() => {});
  await deps.writeFile(target.input, prompt);
  const text = await waitForFile(target.output, config.museTimeoutMs, deps);
  await deps.unlink(target.output).catch(() => {});
  await deps.unlink(target.input).catch(() => {});
  return parseRebuttal(text);
}

/** Full council process for one episode. Errors propagate so the caller can skip it. */
export async function processItem(item, config, deps, client) {
  deps.currentEpisodeId = item.episode_id;
  const checks = [runQuickdraw(item, config, deps), runScholar(item, config, deps)];
  if (config.qwenUrl) checks.push(runQwen(item, config, deps));
  const members = (await Promise.all(checks)).filter(Boolean);
  const lead = await runLead(item, members, config, deps);
  const rebuttals = [];
  for (let i = 0; i < lead.dismissed.length; i += 1) {
    const d = lead.dismissed[i];
    rebuttals.push(await runRebuttal(config, deps, d.flag, d.reason, i));
  }
  const submission = buildSubmission(item, members, lead, rebuttals);
  const result = await client.submit(item.episode_id, submission);
  const qwen = members.find((member) => member.persona === "qwen");
  return { submission, result, qwenComparison: qwen ? {
    episode_id: item.episode_id,
    qwen_flagged: qwen.notes.length > 0,
    lead_verdict: submission.verdict,
    disagreed: (qwen.notes.length > 0) !== (submission.verdict === "fail"),
  } : null };
}

export async function recordQwenComparison(comparison, config, deps = {}) {
  if (!comparison) return null;
  const read = deps.readFile || readFile;
  const write = deps.appendFile || appendFile;
  let history = "";
  try { history = await read(config.qwenDisagreementLog, "utf8"); } catch {}
  const prior = history.split("\n").filter(Boolean).length;
  if (prior >= 50) return { count: 50, disagreed: null };
  await write(config.qwenDisagreementLog, `${JSON.stringify({ ...comparison, checked_at: new Date().toISOString() })}\n`);
  const count = prior + 1;
  const disagreements = history.split("\n").filter(Boolean).reduce((n, row) => {
    try { return n + (JSON.parse(row).disagreed === true ? 1 : 0); } catch { return n; }
  }, comparison.disagreed ? 1 : 0);
  return { count, disagreed: comparison.disagreed, rate: disagreements / count };
}

/** Poll loop. ONCE/--once runs a single pass and exits. */
export async function run(config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const log = deps.log || (() => {});
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const signal = deps.signal || { aborted: false };
  const client = deps.client || createClient({ baseUrl: config.baseUrl, token: config.token, fetch: fetchImpl });
  const io = {
    ...deps,
    fetch: fetchImpl,
    log,
    sleep,
    execFile: deps.execFile || execFileAsync,
    readFile: deps.readFile || readFile,
    writeFile: deps.writeFile || writeFile,
    unlink: deps.unlink || unlink,
    mkdir: deps.mkdir || mkdir,
  };
  do {
    let items;
    try {
      items = await client.pending();
    } catch (err) {
      if (err instanceof CouncilApiError && [401, 403].includes(err.status)) {
        log(`stopping: ${err.message} (HTTP ${err.status})`);
        return;
      }
      log(`poll failed, retrying: ${err.message}`);
      await sleep(config.pollMs);
      continue;
    }
    log(`found ${items.length} episode(s) awaiting council`);
    for (const item of items) {
      if (signal.aborted) break;
      try {
        const { result, qwenComparison } = await processItem(item, config, io, client);
        log(`episode ${item.episode_id}: ${result?.fact_check?.verdict || "submitted"}`);
        if (qwenComparison) {
          try {
            const monitor = await recordQwenComparison(qwenComparison, config, io);
            if (monitor?.disagreed === null) log("qwen disagreement sample is complete (50 episodes)");
            else log(`qwen disagreement ${monitor.disagreed ? "yes" : "no"} (${monitor.count}/50, ${(monitor.rate * 100).toFixed(1)}%)`);
          } catch (err) {
            log(`qwen disagreement log failed: ${err.message}`);
          }
        }
      } catch (err) {
        log(`episode ${item.episode_id}: skipped (${err.message})`);
      }
    }
    if (config.once || signal.aborted) return;
    await sleep(config.pollMs);
  } while (!signal.aborted);
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
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await run(config, { log: (line) => console.log(line), signal: controller.signal });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
