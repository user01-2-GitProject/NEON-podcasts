"use client";

// "Hear your show": the 60-second, format-specific first-episode preview on
// the wizard's review screen, in the selected host voice.
//
// Cheap by design (see lib/preview.ts): the script is written once per set of
// answers and re-used when only the voice changes, and every voice already
// heard is kept in memory so replaying it costs nothing.

import { useEffect, useMemo, useRef, useState } from "react";
import { OPENAI_VOICE_OPTIONS } from "@/lib/voices";
import type { WizardDraft } from "@/lib/wizard-steps";

type VoiceChoice = { id: string; label: string };

export default function ShowPreview({ draft, hostName, voice, onVoiceChange }: {
  draft: WizardDraft;
  hostName: string;
  voice: string;
  onVoiceChange: (voice: string) => void;
}) {
  const [voices, setVoices] = useState<VoiceChoice[]>(OPENAI_VOICE_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Per-answers script, and per-(answers, voice) audio, so nothing is paid twice.
  const scripts = useRef(new Map<string, string>());
  const audio = useRef(new Map<string, string>());
  const player = useRef<HTMLAudioElement | null>(null);

  // Use the app's full voice list (free voices included) when the server has
  // one; otherwise the built-in OpenAI list.
  useEffect(() => {
    let alive = true;
    fetch("/api/voices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = Array.isArray(data?.voices) ? data.voices : null;
        if (!alive || !list?.length) return;
        setVoices(list.filter((v: unknown): v is VoiceChoice =>
          !!v && typeof (v as VoiceChoice).id === "string" && typeof (v as VoiceChoice).label === "string"));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Everything that changes what the host would say.
  const contentKey = useMemo(
    () => JSON.stringify({ t: draft.title, f: draft.format, h: draft.host_count, a: draft.answers, n: hostName }),
    [draft, hostName],
  );
  const audioKey = `${contentKey}|${voice}`;

  // Show the clip already made for this voice, if any.
  useEffect(() => {
    setAudioUrl(audio.current.get(audioKey) ?? null);
  }, [audioKey]);

  useEffect(() => () => { for (const url of audio.current.values()) URL.revokeObjectURL(url); }, []);

  async function play() {
    const cached = audio.current.get(audioKey);
    if (cached) {
      setAudioUrl(cached);
      if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => {}); }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          host_name: hostName,
          voice,
          script: scripts.current.get(contentKey) || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.script === "string") scripts.current.set(contentKey, data.script);
      if (!res.ok) throw new Error(data.error || "The preview didn't work. Try again.");
      const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.content_type || "audio/mpeg" }));
      audio.current.set(audioKey, url);
      setAudioUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const known = voices.some((v) => v.id === voice);
  return (
    <div className="show-preview">
      <h3 style={{ marginTop: 0 }}>Hear your show</h3>
      <p className="muted">
        A 60-second first-episode sample in {hostName}'s selected voice.
        Try a few voices before you create it.
      </p>
      <label className="muted" htmlFor="preview-voice" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
        {hostName}'s voice
      </label>
      <select
        id="preview-voice"
        className="wizard-input"
        value={voice}
        onChange={(e) => onVoiceChange(e.target.value)}
        disabled={busy}
      >
        {!known && voice ? <option value={voice}>{voice}</option> : null}
        {voices.map((v) => (
          <option key={v.id} value={v.id}>{v.label}</option>
        ))}
      </select>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn secondary" onClick={() => void play()} disabled={busy}>
          {busy ? "Making your preview…" : audioUrl ? "Play again" : "Play a 60-second preview"}
        </button>
      </div>
      {audioUrl ? (
        <audio ref={player} key={audioUrl} src={audioUrl} controls autoPlay style={{ width: "100%", marginTop: 12 }} />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
