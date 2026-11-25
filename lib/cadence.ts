// How often a show airs, and when its next slot is.
//
// Slots are wall-clock times in the show's timezone:
//   twice_daily  schedule_time and schedule_time + 12h, every day
//   daily        schedule_time every day
//   weekdays     schedule_time Monday to Friday
//   twice_weekly schedule_time on Monday and Thursday
//   weekly       schedule_time once a week, on the weekday of the first slot
//   manual       never scheduled
//
// The first slot is computed here in JS (firstSlot). Moving to the following
// slot happens inside SQL statements that must stay atomic, so they share the
// NEXT_SLOT_SQL expression below; tests/cadence.test.cjs checks every copy.

export type Cadence = "twice_daily" | "daily" | "weekdays" | "twice_weekly" | "weekly" | "manual";

export const CADENCES: Cadence[] = ["twice_daily", "daily", "weekdays", "twice_weekly", "weekly", "manual"];
export const SCHEDULED_CADENCES: Cadence[] = CADENCES.filter((c) => c !== "manual");

export const CADENCE_LABELS: Record<Cadence, string> = {
  twice_daily: "Twice a day",
  daily: "Daily",
  weekdays: "Weekdays (Mon–Fri)",
  twice_weekly: "Twice a week (Mon & Thu)",
  weekly: "Weekly",
  manual: "Manual only",
};

export function isCadence(value: unknown): value is Cadence {
  return typeof value === "string" && (CADENCES as string[]).includes(value);
}

export function cadenceLabel(value: string): string {
  return isCadence(value) ? CADENCE_LABELS[value] : value;
}

// Canonical SQL for "this show's slot after next_run_at". Copied verbatim into
// each atomic update (tagged templates can't share a fragment); the cadence
// test fails if a copy drifts.
export const NEXT_SLOT_SQL = `case cadence
      when 'twice_daily' then (((next_run_at at time zone timezone) + interval '12 hours') at time zone timezone)
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekdays' then (((next_run_at at time zone timezone) + (case extract(isodow from (next_run_at at time zone timezone)) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day') at time zone timezone)
      when 'twice_weekly' then (((next_run_at at time zone timezone) + (case when extract(isodow from (next_run_at at time zone timezone)) < 4 then 4 - extract(isodow from (next_run_at at time zone timezone)) else 8 - extract(isodow from (next_run_at at time zone timezone)) end) * interval '1 day') at time zone timezone)
      when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
      else null
    end`;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

// UTC instant for a wall-clock time in timeZone (DST gaps resolve forward, like Postgres).
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = wall - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

// ISO weekday (1 = Monday … 7 = Sunday) of a calendar date.
function isoDow(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
}

function dayAllowed(cadence: Cadence, dow: number): boolean {
  if (cadence === "weekdays") return dow <= 5;
  if (cadence === "twice_weekly") return dow === 1 || dow === 4;
  return true;
}

// The first slot strictly after `now`, or null for manual / invalid input.
export function firstSlot(cadence: string, scheduleTime: string, timeZone: string, now: Date = new Date()): Date | null {
  if (!isCadence(cadence) || cadence === "manual") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(scheduleTime);
  if (!m) return null;
  let today: LocalParts;
  try {
    today = localParts(now, timeZone);
  } catch {
    return null;
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const hours = cadence === "twice_daily" ? [hour, (hour + 12) % 24].sort((a, b) => a - b) : [hour];
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const [y, mo, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    if (!dayAllowed(cadence, isoDow(y, mo, d))) continue;
    for (const h of hours) {
      const slot = zonedToUtc(y, mo, d, h, minute, timeZone);
      if (slot.getTime() > now.getTime()) return slot;
    }
  }
  return null;
}
