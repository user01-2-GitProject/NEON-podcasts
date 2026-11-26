"use client";

import { useEffect, useRef, useState } from "react";
import { voiceSampleLine } from "@/lib/preview";
import type { CatalogVoice } from "@/lib/voices";

// Settings → Voice: a "Hear it" button beside every voice, so an owner can
// audition them all without making an episode. Each tap reads one fixed
// ~5-second line through /api/preview with a ready script, which skips the
// writer: it costs only the voice (nothing for the free ones). Clips are kept
// for the visit, so a second tap replays without asking again.
type VoicesResponse = { voices: CatalogVoice[]; available: { openai: boolean } };

export default function VoiceAudition() {
  const [list, setList] = useState<VoicesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const clips = useRef(new Map<string, string>());
  const player = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => () => { for (const url of clips.current.values()) URL.revokeObjectURL(url); }, []);

  // /api/voices lists only voices that can speak right now (Kokoro only when a
  // local voice server is set), so every row here has a working "Hear it".
  async function load() {
    if (list) return;
    try {
      const res = await fetch("/api/voices");
      if (!res.ok) throw new Error("We couldn't load the voices. Try again.");
      setList((await res.json()) as VoicesResponse);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  function playUrl(id: string, url: string) {
    player.current?.pause();
    const audio = new Audio(url);
    player.current = audio;
    setPlaying(id);
    audio.onended = () => setPlaying((p) => (p === id ? null : p));
    void audio.play().catch(() => setPlaying(null));
  }

  async function hear(v: CatalogVoice) {
    setError(null);
    const cached = clips.current.get(v.id);
    if (cached) return playUrl(v.id, cached);
    setBusy(v.id);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: v.id, script: voiceSampleLine(v.label) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.audio_base64 !== "string") throw new Error(data.error || "That voice didn't play. Try again.");
      const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.content_type || "audio/mpeg" }));
      clips.current.set(v.id, url);
      playUrl(v.id, url);
    } catch (e) {
      setError({ id: v.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const group = (title: string, voices: CatalogVoice[], note?: string) => (
    <div style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{title}</h3>
      {note ? <p className="muted" style={{ margin: "0 0 6px", fontSize: 13 }}>{note}</p> : null}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {voices.map((v) => (
          <li key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary"
              style={{ minWidth: 92 }}
              disabled={busy !== null}
              aria-label={`Hear ${v.label}`}
              onClick={() => void hear(v)}
            >
              {busy === v.id ? "Loading…" : playing === v.id ? "▶ Playing" : "Hear it"}
            </button>
            <span>{v.label}</span>
            {error?.id === v.id ? <span className="error" style={{ flexBasis: "100%", fontSize: 13 }}>{error.message}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <details style={{ marginTop: 18 }} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void load(); }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hear the voices</summary>
      <p className="muted" style={{ fontSize: 13 }}>Each one says a short hello. The free voices cost nothing to try.</p>
      {loadError ? <p className="error">{loadError}</p> : null}
      {!list && !loadError ? <p className="muted">Loading voices…</p> : null}
      {list ? group("Free voices", list.voices.filter((v) => v.free)) : null}
      {list
        ? group(
            "OpenAI voices",
            list.voices.filter((v) => v.source === "openai"),
            list.available.openai ? "Uses your OpenAI key; a hello costs a fraction of a cent." : "Add an OpenAI key above to hear these.",
          )
        : null}
    </details>
  );
}
