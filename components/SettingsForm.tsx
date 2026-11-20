"use client";

import { useEffect, useState } from "react";

type SettingsView = {
  provider: "anthropic" | "openrouter";
  openrouter_model: string;
  openrouter_key_set: boolean;
  openrouter_key_source: "settings" | "env" | "none";
  openrouter_key_hint: string | null;
  provider_source: string;
  model_source: string;
};

export default function SettingsForm() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openrouter">("openrouter");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/settings");
      const data = (await res.json()) as SettingsView;
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || "Failed to load settings");
      setView(data);
      setProvider(data.provider);
      setModel(data.openrouter_model || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = {
        provider,
        openrouter_model: model,
      };
      if (apiKey.trim() !== "") payload.openrouter_api_key = apiKey.trim();

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as SettingsView;
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || "Failed to save");
      setView(data);
      setProvider(data.provider);
      setModel(data.openrouter_model || "");
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear_openrouter_api_key: true }),
      });
      const data = (await res.json()) as SettingsView;
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || "Failed to clear key");
      setView(data);
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const keyPlaceholder =
    view?.openrouter_key_source === "settings"
      ? `Saved: ${view.openrouter_key_hint ?? "••••"} — paste a new key to replace`
      : view?.openrouter_key_source === "env"
        ? "Set via environment — paste a key here to override"
        : "sk-or-...";

  return (
    <div className="panel">
      <h2>Settings</h2>
      <p className="muted">
        Choose the script model provider and paste your OpenRouter key here, so you don&apos;t have
        to touch environment variables. Settings saved here override any env vars.
      </p>

      {view === null && !error ? <p className="muted">Loading…</p> : null}

      <form onSubmit={save}>
        <label htmlFor="provider">Script provider</label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as "anthropic" | "openrouter")}
        >
          <option value="openrouter">OpenRouter (one key → Claude, GPT, and more)</option>
          <option value="anthropic">Anthropic (direct API, uses ANTHROPIC_API_KEY)</option>
        </select>

        {provider === "openrouter" ? (
          <>
            <label htmlFor="model" style={{ marginTop: 12 }}>
              OpenRouter model
            </label>
            <input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="anthropic/claude-sonnet-4.5"
            />
            <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              Any slug from openrouter.ai/models (e.g. <code>openai/gpt-4o</code>,{" "}
              <code>anthropic/claude-sonnet-4.5</code>). Leave blank for the default.
            </p>

            <label htmlFor="apiKey" style={{ marginTop: 12 }}>
              OpenRouter API key
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyPlaceholder}
            />
            {view?.openrouter_key_source === "settings" ? (
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn secondary" onClick={clearKey} disabled={busy}>
                  Clear saved key
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            Anthropic uses the server&apos;s <code>ANTHROPIC_API_KEY</code>. There&apos;s no in-app
            field for it yet — switch to OpenRouter to paste a key here.
          </p>
        )}

        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted" style={{ marginTop: 8 }}>✅ Saved</p> : null}

        <div style={{ marginTop: 14 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
