"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LiveApiError, liveFetch, type LiveParticipant, type LiveSession } from "@/lib/live-ui";

type SessionRow = LiveSession & { participant_count: number | null };

function StatusTag({ status }: { status: string }) {
  const className = status === "live" ? "tag active" : status === "ended" ? "tag failed" : "tag";
  return <span className={className}>{status}</span>;
}

export default function LiveSessions() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setUnauthorized(false);
    try {
      const { sessions: list } = await liveFetch<{ sessions: LiveSession[] }>("/api/live/sessions");
      // The list endpoint returns session metadata only; presence lives on the
      // session detail endpoint. Fetch details in parallel for the count.
      const rows = await Promise.all(
        list.map(async (session) => {
          try {
            const detail = await liveFetch<{ participants: LiveParticipant[] }>(`/api/live/${session.id}`);
            return { ...session, participant_count: detail.participants.length };
          } catch {
            return { ...session, participant_count: null };
          }
        }),
      );
      setSessions(rows);
    } catch (err) {
      if (err instanceof LiveApiError && err.status === 401) {
        setUnauthorized(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (unauthorized) {
    return (
      <section className="panel">
        <h2>Sign in required</h2>
        <p className="muted">Your session has expired. Sign in again to see live podcasts.</p>
        <Link href="/login?next=/live" className="btn secondary">Sign in</Link>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <h2>Sessions</h2>
        <p className="muted">Scheduled and live podcast sessions. Updates on reload.</p>

        {error ? <p className="error">{error}</p> : null}

        {sessions === null && !error ? (
          <p className="muted">Loading sessions…</p>
        ) : sessions?.length === 0 ? (
          <p className="muted">No sessions yet. Check back soon.</p>
        ) : (
          <div>
            {sessions?.map((session) => (
              <div className="list-item" key={session.id}>
                <div>
                  <Link href={`/live/${session.id}`} style={{ fontWeight: 600 }}>
                    {session.title}
                  </Link>
                  <div className="muted" style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusTag status={session.status} />
                    <span>
                      {session.participant_count === null
                        ? "participants —"
                        : `${session.participant_count} participant${session.participant_count === 1 ? "" : "s"}`}
                    </span>
                    <span>· max {session.max_participants}</span>
                  </div>
                </div>
                <Link href={`/live/${session.id}`} className="btn secondary">
                  Open
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <AgentHowTo />
    </>
  );
}

function AgentHowTo() {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontWeight: 600, fontSize: "1rem", display: "flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>&#9654;</span>
        Bring your AI agent
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginBottom: 8 }}>
            Your AI agent (Codex, Claude Code, or any script) can join live sessions using your own LLM key. Three steps:
          </p>
          <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Go to <strong>Settings &rarr; Devices &rarr; Create agent token</strong> (pick &ldquo;Join and speak&rdquo;).</li>
            <li>Copy the session ID from a live session&rsquo;s URL.</li>
            <li>
              Run one of the agent scripts:
              <pre style={{ background: "var(--bg-inset, #1a1a2e)", padding: 12, borderRadius: 8, marginTop: 8, overflowX: "auto", fontSize: "0.85rem" }}>{`# OpenAI (Codex CLI, GPT agents)
NEON_BASE_URL=${typeof window !== "undefined" ? window.location.origin : ""} \\
NEON_TOKEN=npt_<your-token> \\
NEON_SESSION_ID=<session-uuid> \\
OPENAI_API_KEY=sk-... \\
node scripts/live-agent-openai.mjs

# Anthropic (Claude Code)
NEON_BASE_URL=${typeof window !== "undefined" ? window.location.origin : ""} \\
NEON_TOKEN=npt_<your-token> \\
NEON_SESSION_ID=<session-uuid> \\
ANTHROPIC_API_KEY=sk-ant-... \\
node scripts/live-agent-anthropic.mjs`}</pre>
            </li>
          </ol>
          <p className="muted" style={{ marginTop: 8 }}>
            The agent uses <em>your</em> API key &mdash; NEON pays no LLM cost. Add <code>--once</code> for a single reply, or let it run to chat continuously. See <code>docs/live-agents.md</code> for the full guide.
          </p>
        </div>
      )}
    </section>
  );
}
