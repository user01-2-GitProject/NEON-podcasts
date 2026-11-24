"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  LiveApiError,
  liveFetch,
  type LiveParticipant,
  type LiveSession,
  type LiveTurn,
} from "@/lib/live-ui";

type ComposerKind = "speech" | "chat";
type ParticipantPatch = { role?: LiveParticipant["role"]; muted?: boolean };

const TURN_POLL_MS = 2500;
const SESSION_POLL_MS = 5000;
const HEARTBEAT_MS = 30000;

function fmt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function StatusTag({ status }: { status: string }) {
  const className = status === "live" ? "tag active" : status === "ended" ? "tag failed" : "tag";
  return <span className={className}>{status}</span>;
}

export default function LiveRoom({ sessionId, isOwner }: { sessionId: string; isOwner: boolean }) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [latestSeq, setLatestSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [composerKind, setComposerKind] = useState<ComposerKind>("chat");
  const [turnText, setTurnText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  // Refs keep the polling intervals from closing over stale state.
  const latestSeqRef = useRef(0);
  const joinedRef = useRef(false);

  const setJoinedState = useCallback((value: boolean) => {
    joinedRef.current = value;
    setJoined(value);
  }, []);

  const reportError = useCallback((err: unknown) => {
    if (err instanceof LiveApiError && err.status === 401) {
      setUnauthorized(true);
      setError(null);
      return;
    }
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const applyTurns = useCallback((incoming: LiveTurn[]) => {
    const fresh = incoming.filter((turn) => turn.seq > latestSeqRef.current);
    if (fresh.length === 0) return;
    latestSeqRef.current = Math.max(latestSeqRef.current, ...fresh.map((turn) => turn.seq));
    setLatestSeq(latestSeqRef.current);
    setTurns((previous) => [...previous, ...fresh].sort((a, b) => a.seq - b.seq));
  }, []);

  const refreshSession = useCallback(async () => {
    const data = await liveFetch<{ session: LiveSession; participants: LiveParticipant[] }>(
      `/api/live/${sessionId}`,
    );
    setSession(data.session);
    setParticipants(data.participants);
  }, [sessionId]);

  const pollTurns = useCallback(async () => {
    const data = await liveFetch<{ turns: LiveTurn[] }>(
      `/api/live/${sessionId}/turns?after=${latestSeqRef.current}`,
    );
    applyTurns(data.turns);
  }, [sessionId, applyTurns]);

  useEffect(() => {
    let active = true;

    async function initialLoad() {
      setLoading(true);
      try {
        await refreshSession();
        await pollTurns();
        // A heartbeat is the only read-ish way to learn whether this browser is
        // already joined; a 404 just means "not present" and is expected.
        try {
          await liveFetch(`/api/live/${sessionId}/heartbeat`, { method: "POST" });
          if (active) setJoinedState(true);
        } catch {
          if (active) setJoinedState(false);
        }
      } catch (err) {
        if (active) reportError(err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialLoad();

    const turnTimer = setInterval(() => {
      void pollTurns().catch(reportError);
    }, TURN_POLL_MS);
    const sessionTimer = setInterval(() => {
      void refreshSession().catch(reportError);
    }, SESSION_POLL_MS);
    const heartbeatTimer = setInterval(() => {
      if (!joinedRef.current) return;
      void liveFetch(`/api/live/${sessionId}/heartbeat`, { method: "POST" }).catch(() => {});
    }, HEARTBEAT_MS);

    return () => {
      active = false;
      clearInterval(turnTimer);
      clearInterval(sessionTimer);
      clearInterval(heartbeatTimer);
    };
  }, [sessionId, refreshSession, pollTurns, reportError, setJoinedState]);

  async function join(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || session?.status !== "live") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await liveFetch<{ participant: LiveParticipant }>(`/api/live/${sessionId}/join`, {
        method: "POST",
        body: JSON.stringify({ display_name: name }),
      });
      setJoinedState(true);
      setNotice(`Joined as ${name}.`);
      await refreshSession();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await liveFetch(`/api/live/${sessionId}/leave`, { method: "POST" });
      setJoinedState(false);
      setNotice("You left the session. Your turns stay in the transcript.");
      await refreshSession();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function postTurn(event: FormEvent) {
    event.preventDefault();
    const text = turnText.trim();
    if (!text || !joinedRef.current || session?.status !== "live") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await liveFetch<{ seq: number }>(`/api/live/${sessionId}/turns`, {
        method: "POST",
        body: JSON.stringify({ kind: composerKind, text }),
      });
      setTurnText("");
      setNotice(composerKind === "speech" ? "Speech queued." : "Chat posted.");
      await pollTurns();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "live" | "ended") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await liveFetch<{ session: LiveSession }>(`/api/live/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setSession(data.session);
      setNotice(status === "live" ? "Session is live." : "Session ended.");
      await refreshSession();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function moderate(participant: LiveParticipant, patch: ParticipantPatch) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await liveFetch(`/api/live/${sessionId}/participants/${participant.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setNotice(`Updated ${participant.display_name}.`);
      await refreshSession();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  if (unauthorized) {
    return (
      <section className="panel">
        <h2>Sign in required</h2>
        <p className="muted">Your session has expired. Sign in again to take part.</p>
        <Link href={`/login?next=${encodeURIComponent(`/live/${sessionId}`)}`} className="btn secondary">
          Sign in
        </Link>
      </section>
    );
  }

  const isLive = session?.status === "live";

  return (
    <>
      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>{session?.title ?? (loading ? "Loading session…" : "Session")}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {participants.length} present · max {session?.max_participants ?? "—"} · turns poll every{" "}
              {TURN_POLL_MS / 1000}s · latest seq {latestSeq}
            </p>
          </div>
          {session ? <StatusTag status={session.status} /> : null}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Started {fmt(session?.started_at ?? null)} · Ended {fmt(session?.ended_at ?? null)}
        </p>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted" role="status">{notice}</p> : null}
      {loading && !session ? <section className="panel"><p className="muted">Loading session…</p></section> : null}

      {isOwner ? (
        <section className="panel">
          <h2>Host controls</h2>
          <div className="row" style={{ alignItems: "center" }}>
            <button type="button" disabled={busy || session?.status !== "scheduled"} onClick={() => setStatus("live")}>
              Go live
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || !session || session.status === "ended"}
              onClick={() => setStatus("ended")}
            >
              End session
            </button>
            <span className="muted">Host controls are owner-only on the API too.</span>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Join &amp; speak</h2>
        {session && session.status === "scheduled" ? (
          <p className="muted">This session has not gone live yet.</p>
        ) : null}
        {session && session.status === "ended" ? (
          <p className="muted">This session has ended. The transcript stays available.</p>
        ) : null}

        {isLive && !joined ? (
          <form className="row" style={{ alignItems: "flex-end" }} onSubmit={join}>
            <div>
              <label htmlFor="live-display-name">Display name</label>
              <input
                id="live-display-name"
                value={displayName}
                maxLength={40}
                placeholder="e.g. Alice"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div style={{ flex: "none" }}>
              <button type="submit" disabled={busy || !displayName.trim()}>Join session</button>
            </div>
          </form>
        ) : null}

        {isLive && joined ? (
          <div style={{ marginBottom: 12 }}>
            <p className="muted" style={{ marginTop: 0 }}>You&apos;re joined. Presence is kept alive automatically.</p>
            <button type="button" className="secondary" disabled={busy} onClick={leave}>Leave session</button>
          </div>
        ) : null}

        <form onSubmit={postTurn}>
          <label htmlFor="live-turn-kind">Post as</label>
          <select
            id="live-turn-kind"
            value={composerKind}
            onChange={(event) => setComposerKind(event.target.value === "speech" ? "speech" : "chat")}
            disabled={!joined || !isLive || busy}
          >
            <option value="chat">Chat</option>
            <option value="speech">Speech (host/guest only)</option>
          </select>

          <label htmlFor="live-turn-text">Message</label>
          <textarea
            id="live-turn-text"
            value={turnText}
            maxLength={4000}
            placeholder={composerKind === "speech" ? "What should the host say?" : "Say something to everyone…"}
            onChange={(event) => setTurnText(event.target.value)}
            disabled={!joined || !isLive || busy}
          />
          <div style={{ marginTop: 10 }}>
            <button type="submit" disabled={busy || !joined || !isLive || !turnText.trim()}>
              {composerKind === "speech" ? "Queue speech" : "Send chat"}
            </button>
            {!joined && isLive ? <span className="muted" style={{ marginLeft: 10 }}>Join first to post.</span> : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Participants</h2>
        {participants.length === 0 ? (
          <p className="muted">No one is here yet.</p>
        ) : (
          <div>
            {participants.map((participant) => (
              <div className="list-item" key={participant.id}>
                <div>
                  <strong>{participant.display_name}</strong>
                  <div className="muted" style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="tag">{participant.kind}</span>
                    <span className="tag">{participant.role}</span>
                    {participant.muted ? <span className="tag failed">muted</span> : null}
                    {participant.away ? <span className="tag">away</span> : null}
                  </div>
                </div>
                {isOwner ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {participant.role === "listener" ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => moderate(participant, { role: "guest" })}
                      >
                        Promote
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => moderate(participant, { muted: !participant.muted })}
                    >
                      {participant.muted ? "Unmute" : "Mute"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel" aria-live="polite">
        <h2>Transcript</h2>
        {turns.length === 0 ? (
          <p className="muted">No turns yet. Be the first to chat.</p>
        ) : (
          <div>
            {turns.map((turn) => (
              <div className="list-item" key={turn.seq} style={{ alignItems: "flex-start", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{turn.participant.display_name}</strong>
                  <span className="tag">{turn.participant.kind}</span>
                  <span className="tag">{turn.participant.role}</span>
                  <span className="tag active">{turn.kind}</span>
                  <span className="muted">#{turn.seq}</span>
                  <span className="muted">{fmt(turn.created_at)}</span>
                </div>
                <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{turn.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
