export type Cadence = "daily" | "weekly" | "manual";
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
  narration_mode: NarrationMode;
  cadence: Cadence;
  schedule_time: string;
  timezone: string;
  target_minutes: number;
  rss_token: string;
  is_public: boolean;
  next_run_at: string | null;
  is_active: boolean;
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
  scheduled_for: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  started_at: string;
  finished_at: string | null;
}
