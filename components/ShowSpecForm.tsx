"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  BODY_TEMPLATE,
  emptyShowSpec,
  parseShowMd,
  toShowMd,
  validateShowSpec,
  type ShowSpec,
} from "@/lib/show-spec";

// One form for the canonical show spec. Fill it in by hand, or import a
// show.md to fill it; "Download show.md" exports the same thing back out.
export default function ShowSpecForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [spec, setSpec] = useState<ShowSpec>(() => ({
    ...emptyShowSpec(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    body: BODY_TEMPLATE,
  }));
  const [pronText, setPronText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof ShowSpec>(key: K, value: ShowSpec[K]) => setSpec((s) => ({ ...s, [key]: value }));
  const host = (i: number) => spec.hosts[i] ?? { name: "", voice: "" };
  function setHost(i: number, field: "name" | "voice", value: string) {
    setSpec((s) => {
      const hosts = [0, 1].map((j) => ({ ...(s.hosts[j] ?? { name: "", voice: "" }) }));
      hosts[i][field] = value;
      return { ...s, hosts: hosts.filter((h) => h.name || h.voice) };
    });
  }

  // "TERM => say as" per line; a trailing " (substring)" switches match mode.
  function currentSpec(): ShowSpec {
    const pronunciations = pronText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [term, rest = ""] = line.split("=>").map((x) => x.trim());
        const substring = /\(substring\)$/i.test(rest);
        return { term, say_as: rest.replace(/\(substring\)$/i, "").trim(), match: substring ? "substring" as const : "word" as const };
      });
    return { ...spec, pronunciations };
  }

  async function importFile(file: File) {
    setNotice(null);
    const { spec: parsed, errors: errs } = parseShowMd(await file.text());
    setSpec(parsed);
    setPronText(
      parsed.pronunciations.map((p) => `${p.term} => ${p.say_as}${p.match === "substring" ? " (substring)" : ""}`).join("\n"),
    );
    setErrors(errs);
    if (!errs.length) setNotice(`Loaded ${file.name}. Check the fields, then create the show.`);
  }

  function download() {
    const blob = new Blob([toShowMd(currentSpec())], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(spec.title || "show").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "show"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = currentSpec();
    const errs = validateShowSpec(s);
    setErrors(errs);
    setNotice(null);
    if (errs.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/shows/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: s }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.errors || [data.error || "Failed to create show"]).join("\n"));
      router.push(`/shows/${data.show.id}`);
    } catch (err) {
      setErrors((err instanceof Error ? err.message : String(err)).split("\n"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>New show</h2>
      <p className="muted">
        Fill this in, or{" "}
        <button type="button" className="linklike" onClick={() => fileRef.current?.click()}>
          import a show.md
        </button>{" "}
        to fill it for you.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
      <form onSubmit={submit}>
        <label htmlFor="spec-title">Title</label>
        <input id="spec-title" value={spec.title} onChange={(e) => set("title", e.target.value)} required />

        <label htmlFor="spec-tagline">Tagline</label>
        <input
          id="spec-tagline"
          value={spec.tagline}
          onChange={(e) => set("tagline", e.target.value)}
          placeholder="One line: what the show is about"
        />

        <div className="row">
          <div>
            <label htmlFor="spec-host">Host</label>
            <input id="spec-host" value={host(0).name} onChange={(e) => setHost(0, "name", e.target.value)} />
          </div>
          <div>
            <label htmlFor="spec-voice">Voice</label>
            <input
              id="spec-voice"
              value={host(0).voice}
              onChange={(e) => setHost(0, "voice", e.target.value)}
              placeholder="voice id (optional)"
            />
          </div>
          <div>
            <label htmlFor="spec-host2">Host 2</label>
            <input id="spec-host2" value={host(1).name} onChange={(e) => setHost(1, "name", e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="spec-cadence">Cadence</label>
            <select
              id="spec-cadence"
              value={spec.cadence}
              onChange={(e) => set("cadence", e.target.value as ShowSpec["cadence"])}
            >
              <option value="manual">Manual</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div>
            <label htmlFor="spec-time">Time</label>
            <input
              id="spec-time"
              type="time"
              value={spec.schedule_time}
              onChange={(e) => set("schedule_time", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="spec-tz">Timezone</label>
            <input id="spec-tz" value={spec.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="spec-minutes">Target minutes</label>
            <input
              id="spec-minutes"
              type="number"
              min={1}
              max={120}
              value={Number.isFinite(spec.target_minutes) ? spec.target_minutes : ""}
              onChange={(e) => set("target_minutes", Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="spec-narration">Narration</label>
            <select
              id="spec-narration"
              value={spec.narration_mode}
              onChange={(e) => set("narration_mode", e.target.value as ShowSpec["narration_mode"])}
            >
              <option value="auto">Auto (app renders TTS)</option>
              <option value="external">Script only (e.g. Muse)</option>
            </select>
          </div>
          <div>
            <label htmlFor="spec-image">Artwork URL</label>
            <input
              id="spec-image"
              value={spec.image_url}
              onChange={(e) => set("image_url", e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>

        <label htmlFor="spec-body">Show brief (voice &amp; style, segments, sources &amp; guardrails)</label>
        <textarea id="spec-body" rows={14} value={spec.body} onChange={(e) => set("body", e.target.value)} />

        <label htmlFor="spec-pron">Pronunciations (one per line: TERM =&gt; say as)</label>
        <textarea
          id="spec-pron"
          rows={3}
          value={pronText}
          onChange={(e) => setPronText(e.target.value)}
          placeholder={"FOMC => F O M C\n0DTE => zero D T E"}
        />

        {errors.length ? (
          <ul className="error">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}
        {notice ? <p className="muted">{notice}</p> : null}
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || !spec.title.trim()}>
            {busy ? "Creating…" : "Create show"}
          </button>
          <button type="button" className="secondary" onClick={download}>
            Download show.md
          </button>
        </div>
      </form>
    </div>
  );
}
