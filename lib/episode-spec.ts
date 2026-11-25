// Per-episode plans (templates/episode.example.md, from jimmy's
// Episode-Template.md). An episode plan is a briefing doc whose frontmatter
// says which episode it is and whether it's ready. At generation time the
// earliest ready plan that's due is used for that one episode (its title is
// requested and its body becomes the briefing), then it's switched off so it
// isn't reused. Briefings without episode frontmatter behave as before.

import { parseFrontmatter } from "@/lib/show-spec";

export type EpisodeStatus = "ready" | "not_ready" | "completed";

export interface EpisodePlan {
  title: string;
  episode: string;
  status: EpisodeStatus;
  /** YYYY-MM-DD, or null when unset / still the template placeholder. */
  air_date: string | null;
  hosts: string[];
  notes: string;
  /** Markdown body with the frontmatter removed. */
  body: string;
}

const PLAN_KEYS = ["status", "air_date", "episode"];
const SHOW_KEYS = ["cadence", "narration_mode", "schedule_time", "target_minutes"];

function text(v: unknown): string {
  return v === null || v === undefined || typeof v === "object" ? "" : String(v).trim();
}

export function parseStatus(raw: string): EpisodeStatus {
  const s = raw.toLowerCase();
  if (s.includes("completed") || s.includes("do not use") || s.includes("🔴")) return "completed";
  if (s.includes("not ready") || s.includes("🟡")) return "not_ready";
  return "ready"; // "🟢 Ready", "ready", or no status at all
}

/** Accepts MM-DD-YYYY (the vault's format) or YYYY-MM-DD; anything else is null. */
export function parseAirDate(raw: string): string | null {
  let m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[3]), Number(m[1]), Number(m[2])];
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Returns the plan, or null if this doc isn't an episode plan. */
export function parseEpisodeMd(content: string): EpisodePlan | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!m) return null;
  const { data } = parseFrontmatter(m[1]);
  const keys = Object.keys(data);
  if (!PLAN_KEYS.some((k) => keys.includes(k)) || SHOW_KEYS.some((k) => keys.includes(k))) return null;
  const hosts = Array.isArray(data.hosts)
    ? data.hosts
        .map((h) => (h && typeof h === "object" && !Array.isArray(h) ? text((h as Record<string, unknown>).name) : text(h)))
        .filter(Boolean)
    : [];
  return {
    title: text(data.title),
    episode: text(data.episode),
    status: parseStatus(text(data.status)),
    air_date: parseAirDate(text(data.air_date)),
    hosts,
    notes: text(data.notes),
    body: m[2].trim(),
  };
}

/** Today's date (YYYY-MM-DD) in a show's timezone. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

interface Doc {
  id: string;
  filename: string;
  content_md: string;
}

export interface BriefingSelection<T extends Doc> {
  /** Docs to send to the scriptwriter (plan docs rewritten without frontmatter). */
  docs: { filename: string; content_md: string }[];
  plan: (EpisodePlan & { briefingId: string }) | null;
  /** Plans held back this run (not ready, completed, or not due yet). */
  skipped: T[];
}

/**
 * Split active briefings into regular docs plus at most one episode plan:
 * the ready plan with the earliest air date that's on or before today
 * (undated ready plans come after dated ones). Other plans are held back.
 */
export function selectBriefings<T extends Doc>(briefings: T[], today: string): BriefingSelection<T> {
  const regular: T[] = [];
  const candidates: { doc: T; plan: EpisodePlan }[] = [];
  const skipped: T[] = [];
  for (const b of briefings) {
    const plan = parseEpisodeMd(b.content_md);
    if (!plan) regular.push(b);
    else if (plan.status !== "ready" || (plan.air_date !== null && plan.air_date > today)) skipped.push(b);
    else candidates.push({ doc: b, plan });
  }
  candidates.sort((a, b) => (a.plan.air_date ?? "9999") .localeCompare(b.plan.air_date ?? "9999"));
  const chosen = candidates[0];
  for (const c of candidates.slice(1)) skipped.push(c.doc);

  const docs = regular.map((b) => ({ filename: b.filename, content_md: b.content_md }));
  if (chosen) {
    const p = chosen.plan;
    const header = [
      p.episode ? `Episode: ${p.episode}` : "",
      p.hosts.length ? `Hosts: ${p.hosts.join(", ")}` : "",
      p.notes ? `Producer notes: ${p.notes}` : "",
    ].filter(Boolean);
    docs.push({
      filename: `${chosen.doc.filename} (episode plan)`,
      content_md: [...header, header.length ? "" : null, p.body].filter((x) => x !== null).join("\n").trim(),
    });
  }
  return { docs, plan: chosen ? { ...chosen.plan, briefingId: chosen.doc.id } : null, skipped };
}
