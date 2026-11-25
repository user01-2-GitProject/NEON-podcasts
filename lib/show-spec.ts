// Canonical show spec (docs/show-spec.md): one ShowSpec object that both a
// `show.md` file and the show form produce. Pure: no DB, no imports, so the
// form, the API and the tests all share the same parse/validate/serialize.

// Mirrors lib/cadence.ts (kept literal so this file stays import-free; tests/cadence.test.cjs checks they match).
export type SpecCadence = "twice_daily" | "daily" | "weekdays" | "twice_weekly" | "weekly" | "manual";
export type SpecNarrationMode = "auto" | "external";
export type SpecMatchMode = "word" | "substring";

export interface SpecHost {
  name: string;
  voice: string;
}

export interface SpecPronunciation {
  term: string;
  say_as: string;
  match: SpecMatchMode;
}

export interface ShowSpec {
  title: string;
  tagline: string;
  category: string;
  language: string;
  explicit: boolean;
  image_url: string;
  cadence: SpecCadence;
  schedule_time: string;
  timezone: string;
  target_minutes: number;
  narration_mode: SpecNarrationMode;
  hosts: SpecHost[];
  pronunciations: SpecPronunciation[];
  tags: string[];
  /** Markdown body: Voice & style, Segments, Sources & guardrails. */
  body: string;
}

export const CADENCES: SpecCadence[] = ["twice_daily", "daily", "weekdays", "twice_weekly", "weekly", "manual"];

// Accepts friendly spellings in hand-written show.md ("twice a day", "twice-weekly").
export function normalizeCadence(value: string): string {
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    twice_a_day: "twice_daily",
    twice_per_day: "twice_daily",
    "2x_daily": "twice_daily",
    twice_a_week: "twice_weekly",
    twice_per_week: "twice_weekly",
    "2x_weekly": "twice_weekly",
    weekday: "weekdays",
  };
  return aliases[v] ?? v;
}
export const NARRATION_MODES: SpecNarrationMode[] = ["auto", "external"];
export const MATCH_MODES: SpecMatchMode[] = ["word", "substring"];

export const MAX_SPEC_BYTES = 64 * 1024;
const MAX_LIST = 50;

export function emptyShowSpec(): ShowSpec {
  return {
    title: "",
    tagline: "",
    category: "",
    language: "en-us",
    explicit: false,
    image_url: "",
    cadence: "weekly",
    schedule_time: "09:00",
    timezone: "UTC",
    target_minutes: 5,
    narration_mode: "auto",
    hosts: [],
    pronunciations: [],
    tags: [],
    body: "",
  };
}

// ---------------------------------------------------------------------------
// Minimal YAML-subset reader for frontmatter. Supports exactly what show.md
// uses: `key: scalar`, `key: [a, b]`, `key: { a: 1 }`, and block lists of
// scalars or inline maps (`  - { name: "Iggy", voice: "v2" }`). Anything else
// is reported as an error instead of being guessed at.
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean | null;
type Value = Scalar | Value[] | { [k: string]: Value };

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < s.length) {
        cur += s[++i];
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function parseScalarOrInline(raw: string): Value {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new Error(`unclosed list: ${s}`);
    return splitTopLevel(s.slice(1, -1)).map(parseScalarOrInline);
  }
  if (s.startsWith("{")) {
    if (!s.endsWith("}")) throw new Error(`unclosed map: ${s}`);
    const obj: { [k: string]: Value } = {};
    for (const part of splitTopLevel(s.slice(1, -1))) {
      const idx = part.indexOf(":");
      if (idx <= 0) throw new Error(`bad map entry: ${part}`);
      obj[part.slice(0, idx).trim()] = parseScalarOrInline(part.slice(idx + 1));
    }
    return obj;
  }
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new Error(`unclosed string: ${s}`);
    return JSON.parse(s);
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new Error(`unclosed string: ${s}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseFrontmatter(src: string): { data: Record<string, Value>; errors: string[] } {
  const data: Record<string, Value> = {};
  const errors: string[] = [];
  let listKey: string | null = null;
  src.split(/\r?\n/).forEach((rawLine, i) => {
    const line = stripComment(rawLine);
    if (line.trim() === "") return;
    const lineNo = i + 2; // +1 for 1-based, +1 for the opening ---
    try {
      const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
      if (item) {
        if (!listKey) throw new Error("list item without a key above it");
        (data[listKey] as Value[]).push(parseScalarOrInline(item[1]));
        return;
      }
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!kv || /^\s/.test(line)) throw new Error(`can't read "${line.trim()}"`);
      const [, key, rest] = kv;
      if (rest.trim() === "") {
        data[key] = [];
        listKey = key;
      } else {
        data[key] = parseScalarOrInline(rest);
        listKey = null;
      }
    } catch (e) {
      errors.push(`line ${lineNo}: ${(e as Error).message}`);
    }
  });
  return { data, errors };
}

// ---------------------------------------------------------------------------
// show.md <-> ShowSpec
// ---------------------------------------------------------------------------

const KNOWN_KEYS = new Set([
  "title", "tagline", "category", "language", "explicit", "image_url", "cadence",
  "schedule_time", "timezone", "target_minutes", "narration_mode", "hosts",
  "pronunciations", "tags",
]);

function str(v: Value | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).trim();
}

export function parseShowMd(text: string): { spec: ShowSpec; errors: string[] } {
  const spec = emptyShowSpec();
  if (typeof text !== "string") return { spec, errors: ["show.md must be text"] };
  if (new TextEncoder().encode(text).length > MAX_SPEC_BYTES) {
    return { spec, errors: [`show.md is larger than ${MAX_SPEC_BYTES / 1024} KB`] };
  }
  const normalized = text.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(normalized);
  if (!m) return { spec, errors: ["show.md must start with a --- frontmatter block"] };

  const { data, errors } = parseFrontmatter(m[1]);
  spec.body = m[2].trim();

  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`unknown field "${key}"`);
  }

  if ("title" in data) spec.title = str(data.title);
  if ("tagline" in data) spec.tagline = str(data.tagline);
  if ("category" in data) spec.category = str(data.category);
  if ("language" in data) spec.language = str(data.language) || spec.language;
  if ("image_url" in data) spec.image_url = str(data.image_url);
  if ("schedule_time" in data) spec.schedule_time = str(data.schedule_time);
  if ("timezone" in data) spec.timezone = str(data.timezone);
  if ("cadence" in data) spec.cadence = normalizeCadence(str(data.cadence)) as SpecCadence;
  if ("narration_mode" in data) spec.narration_mode = str(data.narration_mode) as SpecNarrationMode;

  if ("explicit" in data) {
    if (typeof data.explicit !== "boolean") errors.push("explicit must be true or false");
    else spec.explicit = data.explicit;
  }
  if ("target_minutes" in data) {
    if (typeof data.target_minutes !== "number") errors.push("target_minutes must be a number");
    else spec.target_minutes = data.target_minutes;
  }

  const list = (key: string): Value[] => {
    if (!(key in data) || data[key] === null) return [];
    if (!Array.isArray(data[key])) {
      errors.push(`${key} must be a list`);
      return [];
    }
    return data[key] as Value[];
  };
  const isMap = (v: Value): v is { [k: string]: Value } =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  list("hosts").forEach((h, i) => {
    if (!isMap(h)) return void errors.push(`hosts[${i + 1}] must be { name, voice }`);
    spec.hosts.push({ name: str(h.name), voice: str(h.voice) });
  });
  list("pronunciations").forEach((p, i) => {
    if (!isMap(p)) return void errors.push(`pronunciations[${i + 1}] must be { term, say_as, match }`);
    spec.pronunciations.push({
      term: str(p.term),
      say_as: str(p.say_as),
      match: (str(p.match) || "word") as SpecMatchMode,
    });
  });
  spec.tags = list("tags").map(str).filter(Boolean);

  return { spec, errors: [...errors, ...validateShowSpec(spec)] };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The one validator both doors use. Returns human-readable problems. */
// Keep in step with TRUSTED_ART_HOSTS in lib/show-image.ts (this file stays import-free).
export const TRUSTED_ART_HOSTS = ["needlesslyengineeredonlinenetwork.com"];

function trustedArtHost(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return TRUSTED_ART_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function validateShowSpec(spec: ShowSpec): string[] {
  const errors: string[] = [];
  if (!spec.title) errors.push("title is required");
  else if (spec.title.length > 200) errors.push("title must be 200 characters or fewer");
  if (spec.tagline.length > 1000) errors.push("tagline must be 1000 characters or fewer");
  if (!CADENCES.includes(spec.cadence)) {
    errors.push(`cadence must be one of: ${CADENCES.join(", ")}`);
  }
  if (!NARRATION_MODES.includes(spec.narration_mode)) {
    errors.push(`narration_mode must be one of: ${NARRATION_MODES.join(", ")}`);
  }
  if (!HHMM.test(spec.schedule_time)) errors.push("schedule_time must be HH:MM (24-hour)");
  if (!spec.timezone || !isValidTimeZone(spec.timezone)) {
    errors.push("timezone must be an IANA name like America/Detroit");
  }
  if (!Number.isInteger(spec.target_minutes) || spec.target_minutes < 1 || spec.target_minutes > 120) {
    errors.push("target_minutes must be a whole number from 1 to 120");
  }
  if (spec.image_url && !/^https?:\/\/\S+$/i.test(spec.image_url)) {
    errors.push("image_url must be an http(s) URL");
  } else if (spec.image_url && !trustedArtHost(spec.image_url)) {
    errors.push("Picture links are turned off. Leave image_url blank; every show gets a free cover made from its name.");
  }
  if (spec.image_url.length > 2048) errors.push("image_url is too long");
  if (spec.language && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(spec.language)) {
    errors.push("language must be a code like en-us");
  }
  if (spec.hosts.length > MAX_LIST) errors.push(`at most ${MAX_LIST} hosts`);
  spec.hosts.forEach((h, i) => {
    if (!h.name) errors.push(`hosts[${i + 1}] needs a name`);
  });
  if (spec.pronunciations.length > MAX_LIST * 4) errors.push("too many pronunciations");
  spec.pronunciations.forEach((p, i) => {
    if (!p.term || !p.say_as) errors.push(`pronunciations[${i + 1}] needs term and say_as`);
    if (!MATCH_MODES.includes(p.match)) {
      errors.push(`pronunciations[${i + 1}].match must be word or substring`);
    }
  });
  if (spec.tags.length > MAX_LIST) errors.push(`at most ${MAX_LIST} tags`);
  return errors;
}

function q(s: string): string {
  return JSON.stringify(s);
}

/** Serialize back to the canonical show.md layout (form "Download as show.md"). */
export function toShowMd(spec: ShowSpec): string {
  const lines = [
    "---",
    `title: ${q(spec.title)}`,
    `tagline: ${q(spec.tagline)}`,
    `category: ${q(spec.category)}`,
    `language: ${q(spec.language)}`,
    `explicit: ${spec.explicit ? "true" : "false"}`,
    `image_url: ${q(spec.image_url)}`,
    `cadence: ${q(spec.cadence)}`,
    `schedule_time: ${q(spec.schedule_time)}`,
    `timezone: ${q(spec.timezone)}`,
    `target_minutes: ${spec.target_minutes}`,
    `narration_mode: ${q(spec.narration_mode)}`,
  ];
  lines.push(spec.hosts.length ? "hosts:" : "hosts: []");
  for (const h of spec.hosts) lines.push(`  - { name: ${q(h.name)}, voice: ${q(h.voice)} }`);
  lines.push(spec.pronunciations.length ? "pronunciations:" : "pronunciations: []");
  for (const p of spec.pronunciations) {
    lines.push(`  - { term: ${q(p.term)}, say_as: ${q(p.say_as)}, match: ${q(p.match)} }`);
  }
  lines.push(`tags: [${spec.tags.map(q).join(", ")}]`);
  lines.push("---", "", spec.body.trim(), "");
  return lines.join("\n");
}

/**
 * The style guide the generator sees: host line + the show.md body. Kept here
 * so the file door and the form door produce byte-identical prompts.
 */
export function buildStyleGuide(spec: ShowSpec): string {
  const parts: string[] = [];
  if (spec.hosts.length) {
    parts.push(`Host${spec.hosts.length > 1 ? "s" : ""}: ${spec.hosts.map((h) => h.name).join(", ")}`);
  }
  if (spec.body.trim()) parts.push(spec.body.trim());
  return parts.join("\n\n");
}

/** Column values for the shows row (create or update). */
export function specToShowFields(spec: ShowSpec) {
  return {
    title: spec.title,
    description: spec.tagline,
    style_guide: buildStyleGuide(spec),
    voice_id: spec.hosts[0]?.voice || null,
    narration_mode: spec.narration_mode,
    cadence: spec.cadence,
    schedule_time: spec.schedule_time,
    timezone: spec.timezone,
    target_minutes: spec.target_minutes,
    image_url: spec.image_url || null,
  };
}

/**
 * Coerce untrusted JSON (the form's POST body) into a ShowSpec shape. Types
 * are forced, nothing is guessed; run validateShowSpec on the result.
 */
export function coerceShowSpec(input: unknown): ShowSpec {
  const spec = emptyShowSpec();
  if (input === null || typeof input !== "object" || Array.isArray(input)) return spec;
  const o = input as Record<string, unknown>;
  const s = (v: unknown, fallback: string) => (typeof v === "string" ? v.trim() : fallback);
  spec.title = s(o.title, "");
  spec.tagline = s(o.tagline, "");
  spec.category = s(o.category, "");
  spec.language = s(o.language, spec.language) || spec.language;
  spec.image_url = s(o.image_url, "");
  spec.cadence = s(o.cadence, spec.cadence) as SpecCadence;
  spec.schedule_time = s(o.schedule_time, spec.schedule_time);
  spec.timezone = s(o.timezone, spec.timezone);
  spec.narration_mode = s(o.narration_mode, spec.narration_mode) as SpecNarrationMode;
  if (typeof o.explicit === "boolean") spec.explicit = o.explicit;
  if (typeof o.target_minutes === "number") spec.target_minutes = o.target_minutes;
  else if (o.target_minutes !== undefined) spec.target_minutes = NaN;
  const arr = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_LIST * 4) : []);
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  spec.hosts = arr(o.hosts).map((h) => ({ name: s(obj(h).name, ""), voice: s(obj(h).voice, "") }));
  spec.pronunciations = arr(o.pronunciations).map((p) => ({
    term: s(obj(p).term, ""),
    say_as: s(obj(p).say_as, ""),
    match: (s(obj(p).match, "word") || "word") as SpecMatchMode,
  }));
  spec.tags = arr(o.tags).filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
  spec.body = typeof o.body === "string" ? o.body.trim() : "";
  return spec;
}

/** Starter body for the form, matching templates/show.example.md sections. */
export const BODY_TEMPLATE = [
  "## Voice & style",
  "Tone, pacing, do's and don'ts, recurring bits (e.g. the NEON PLUG open and close).",
  "",
  "## Segments",
  "### Segment 1 - <name> (<host>)",
  "What it covers. Frame it: who / what / when / where / why / how. Questions to answer.",
  "",
  "## Sources & guardrails",
  "Where facts come from, what to avoid, accuracy rules.",
].join("\n");

/**
 * Rebuild a ShowSpec from a stored show (export / "Download show.md" on the
 * show page). Inverse of specToShowFields for everything the shows table
 * stores; category, language, explicit and tags aren't stored per show yet,
 * so they come back as defaults.
 */
export function showToSpec(
  show: {
    title: string;
    description: string;
    style_guide: string;
    voice_id: string | null;
    narration_mode: string;
    cadence: string;
    schedule_time: string;
    timezone: string;
    target_minutes: number;
    image_url?: string | null;
  },
  pronunciations: { term: string; say_as: string; match_mode: string }[],
): ShowSpec {
  const spec = emptyShowSpec();
  spec.title = show.title;
  spec.tagline = show.description ?? "";
  spec.narration_mode = show.narration_mode as SpecNarrationMode;
  spec.cadence = show.cadence as SpecCadence;
  spec.schedule_time = show.schedule_time;
  spec.timezone = show.timezone;
  spec.target_minutes = show.target_minutes;
  spec.image_url = show.image_url ?? "";
  let guide = (show.style_guide ?? "").trim();
  const hostLine = /^Hosts?: (.+?)(?:\r?\n\r?\n|$)/.exec(guide);
  if (hostLine) {
    spec.hosts = hostLine[1].split(", ").map((name) => ({ name: name.trim(), voice: "" }));
    guide = guide.slice(hostLine[0].length).trim();
  }
  if (show.voice_id) {
    if (spec.hosts.length) spec.hosts[0].voice = show.voice_id;
    else spec.hosts = [{ name: "Host", voice: show.voice_id }];
  }
  spec.body = guide;
  spec.pronunciations = pronunciations.map((p) => ({
    term: p.term,
    say_as: p.say_as,
    match: p.match_mode as SpecMatchMode,
  }));
  return spec;
}
