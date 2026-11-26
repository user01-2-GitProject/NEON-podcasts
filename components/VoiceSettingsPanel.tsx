"use client";

import { useEffect, useState } from "react";
import VoiceAudition from "@/components/VoiceAudition";

type VoiceView = {
  provider: "openai" | "elevenlabs" | "local" | "edge";
  openai_voice: string;
  voices: string[];
  openai_key_set: boolean;
  openai_key_source: "settings" | "env" | "none";
  openai_key_hint: string | null;
};

// Owner-only: the hosted voice that auto-narrated shows use. One OpenAI key
// here gives every show an mp3 with no local voice server or Muse needed.
export default function VoiceSettingsPanel() {
  const [view, setView] = useState<VoiceView | null>(null);
  const [voice, setVoice] = useState("alloy");
  const [source, setSource] = useState<"edge" | "openai">("edge");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function send(init?: RequestInit) {
    const res = await fetch("/api/settings/voice", init);
    const data = (await res.json().catch(() => ({}))) as VoiceView & { error?: string };
    if (!res.ok) throw new Error(data.error || "Request failed");
    setView(data);
    setVoice(data.openai_voice);
    setSource(data.provider === "openai" ? "openai" : "edge");
  }

  useEffect(() => {
    send().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await send({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { provider: source, openai_voice: voice };
    if (apiKey.trim()) payload.openai_api_key = apiKey.trim();
    void post(payload);
  }

  const placeholder =
    view?.openai_key_source === "settings"
      ? `Saved: ${view.openai_key_hint ?? "••••"} — paste a new key to replace`
      : view?.openai_key_source === "env"
        ? "Set via environment — paste a key here to override"
        : "sk-...";

  return (
    <div className="panel">
      <h2>Voice</h2>
      <p className="muted">
        Which voices read shows set to <strong>Auto</strong>. A show that picked a free voice always uses it for free,
        whatever you choose here. Shows set to Script only are unaffected.
      </p>
      {view === null && !error ? <p className="muted">Loading…</p> : null}
      {view && view.provider !== "openai" && view.provider !== "edge" ? (
        <p className="muted">
          Currently using <code>{view.provider}</code> voices. Saving here switches away from them.
        </p>
      ) : null}
      <form onSubmit={save}>
        <div className="wizard-choices" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`wizard-choice${source === "edge" ? " wizard-choice-selected" : ""}`}
            aria-pressed={source === "edge"}
            onClick={() => setSource("edge")}
          >
            <span className="wizard-choice-title">Free voices</span>
            <span className="muted" style={{ display: "block", fontSize: 13 }}>25 voices, no key, costs nothing.</span>
          </button>
          <button
            type="button"
            className={`wizard-choice${source === "openai" ? " wizard-choice-selected" : ""}`}
            aria-pressed={source === "openai"}
            onClick={() => setSource("openai")}
          >
            <span className="wizard-choice-title">OpenAI voices</span>
            <span className="muted" style={{ display: "block", fontSize: 13 }}>
              Needs your key. Roughly $0.15–0.20 for a 12-minute episode.
            </span>
          </button>
        </div>
        <label htmlFor="voice-key">OpenAI API key (only for OpenAI voices)</label>
        <input
          id="voice-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={placeholder}
        />
        <label htmlFor="voice-name" style={{ marginTop: 12 }}>
          Default OpenAI voice
        </label>
        <select id="voice-name" value={voice} onChange={(e) => setVoice(e.target.value)}>
          {(view?.voices ?? ["alloy"]).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          A show whose voice is one of these names uses it; any other show uses this default.
        </p>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted" style={{ marginTop: 8 }}>✅ Saved</p> : null}
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || view === null}>
            {busy ? "Saving…" : "Save voice"}
          </button>
          {view?.openai_key_source === "settings" ? (
            <button type="button" className="secondary" disabled={busy} onClick={() => void post({ clear_openai_api_key: true })}>
              Clear saved key
            </button>
          ) : null}
        </div>
      </form>
      {view ? <VoiceAudition /> : null}
    </div>
  );
}
