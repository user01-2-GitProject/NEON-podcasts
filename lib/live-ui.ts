// Client-side types and fetch helper for the /live web UI.
// Mirrors the API contract in lib/live.ts and app/api/live/* — no server imports.

export type SessionStatus = "scheduled" | "live" | "ended";
export type ParticipantKind = "human" | "agent";
export type ParticipantRole = "host" | "guest" | "listener";
export type TurnKind = "speech" | "chat" | "system";

export type LiveSession = {
  id: string;
  show_id: string | null;
  title: string;
  status: SessionStatus;
  max_participants: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type LiveParticipant = {
  id: string;
  display_name: string;
  kind: ParticipantKind;
  role: ParticipantRole;
  muted: boolean;
  away: boolean;
};

export type LiveTurn = {
  seq: number;
  kind: TurnKind;
  text: string;
  created_at: string;
  participant: {
    id: string;
    display_name: string;
    kind: ParticipantKind;
    role: ParticipantRole;
  };
};

export class LiveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// All /api/live reads and writes use JSON. The body is supplied here (never a
// user id / email / participant id) so callers can't drift from that contract.
export async function liveFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(path, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `Request failed (${response.status})`;
    throw new LiveApiError(message, response.status);
  }
  return data as T;
}
