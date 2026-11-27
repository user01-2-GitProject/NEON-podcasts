export type { Cadence } from "./cadence";
import type { Cadence } from "./cadence";
import type { ScriptQa } from "./script-qa";
export type NarrationMode = "auto" | "external";
export type EpisodeStatus = "draft" | "published" | "failed";
export type RunStatus = "queued" | "running" | "done" | "failed";

export interface Show {
  id: string;
  user_id: string | null;
  title: string;
  description: string;
  style_guide: string;
  voice_id: string | null;
  hosts?: { name: string; voice: string }[] | null;
  narration_mode: NarrationMode;
  cadence: Cadence;
  schedule_time: string;
  timezone: string;
  target_minutes: number;
  rss_token: string;
  is_public: boolean;
  image_url: string | null;
  /** ISO weekdays (1 = Mon … 7 = Sun) for cadence "days". */
  air_days?: number[] | null;
  /** True for shows made and run by NEON itself — shows a badge next to the title. */
  is_official?: boolean;
  next_run_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  subscriber_email: string;
  show_id: string;
  created_at: string;
}

export type PronunciationMatchMode = "word" | "substring";

export interface Pronunciation {
  id: string;
  show_id: string;
  term: string;
  say_as: string;
  match_mode: PronunciationMatchMode;
  created_at: string;
}

export interface Briefing {
  id: string;
  show_id: string;
  filename: string;
  content_md: string;
  is_active: boolean;
  uploaded_at: string;
}

export interface Episode {
  id: string;
  show_id: string;
  title: string;
  script: string;
  show_notes: string;
  audio_url: string | null;
  duration_seconds: number | null;
  byte_size: number | null;
  status: EpisodeStatus;
  /** True for episodes marked NEON-official by the owner — shows a badge next to the title. */
  is_official?: boolean;
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  show_id: string;
  episode_id: string | null;
  status: RunStatus;
  briefing_snapshot: string | null;
  model: string | null;
  tts_provider: string | null;
  cost_cents: number | null;
  error: string | null;
  /** B1 QA notes for the owner, written when the finished script was checked. */
  script_qa: ScriptQa | null;
  scheduled_for: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  started_at: string;
  finished_at: string | null;
}
