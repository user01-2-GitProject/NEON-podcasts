"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CADENCES, CADENCE_LABELS } from "@/lib/cadence";
import {
  BODY_TEMPLATE,
  emptyShowSpec,
  parseShowMd,
  toShowMd,
  validateShowSpec,
  type ShowSpec,
} from "@/lib/show-spec";
import {
  EMPTY_ANSWERS,
  TONE_IDEAS,
  cleanImageUrl,
  composeBody,
  taglineFrom,
  type GuidedAnswers,
} from "@/lib/show-wizard";

const DRAFT_KEY = "neon:new-show-draft";
const LENGTHS = [3, 5, 10, 15, 20, 30, 45, 60];

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const freshSpec = (): ShowSpec => ({ ...emptyShowSpec(), cadence: "daily", timezone: localZone() });

function friendly(err: string): string {
  if (err === "title is required") return "Give your show a name.";
  if (err.startsWith("timezone")) return "Pick a time zone like America/Detroit (under More options).";
  if (err.startsWith("schedule_time")) return "Pick a time for new episodes.";
  if (err.startsWith("target_minutes")) return "Pick how long each episode should be.";
  return err;
}

// New show in plain questions, in the order people think about a show. The
// answers become the show brief; "More options" holds everything else,
// including the full brief and the show file (.md) import/export.
export default function ShowSpecForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [spec, setSpec] = useState<ShowSpec>(freshSpec);
  const [answers, setAnswers] = useState<GuidedAnswers>(EMPTY_ANSWERS);
  // null = the brief comes from the answers; a string = edited by hand or imported.
  const [rawBody, setRawBody] = useState<string | null>(null);
  const [pronText, setPronText] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // Keep what's typed: restore an unsaved draft, save as you go, and warn
  // before leaving the page with unsaved work.
  const [dirty, setDirty] = useState(false);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (saved?.spec && typeof saved.spec === "object") {
        setSpec((s) => ({ ...s, ...saved.spec }));
        if (saved.answers && typeof saved.answers === "object") setAnswers({ ...EMPTY_ANSWERS, ...saved.answers });
        setRawBody(typeof saved.rawBody === "string" ? saved.rawBody : null);
        setPronText(typeof saved.pronText === "string" ? saved.pronText : "");
        setDirty(true);
        setNotice("We kept what you typed last time.");
      }
    } catch {
      // A broken draft is ignored.
    }
  }, []);
  useEffect(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ spec, answers, rawBody, pronText }));
    } catch {
      // Storage full or blocked: the leave warning still protects the draft.
    }
  }, [dirty, spec, answers, rawBody, pronText]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function startOver() {
    localStorage.removeItem(DRAFT_KEY);
    setDirty(false);
    setSpec(freshSpec());
    setAnswers(EMPTY_ANSWERS);
    setRawBody(null);
    setPronText("");
    setErrors([]);
    setNotice(null);
  }

  const set = <K extends keyof ShowSpec>(key: K, value: ShowSpec[K]) => {
    setDirty(true);
    setSpec((s) => ({ ...s, [key]: value }));
  };
  const answer = (key: keyof GuidedAnswers, value: string) => {
    setDirty(true);
    setAnswers((a) => ({ ...a, [key]: value }));
  };
  const host = (i: number) => spec.hosts[i] ?? { name: "", voice: "" };
  function setHost(i: number, field: "name" | "voice", value: string) {
    setDirty(true);
    setSpec((s) => {
      const hosts = [0, 1].map((j) => ({ ...(s.hosts[j] ?? { name: "", voice: "" }) }));
      hosts[i][field] = value;
      return { ...s, hosts: hosts.filter((h) => h.name || h.voice) };
    });
  }

  const body = rawBody ?? composeBody(answers);

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
    return {
      ...spec,
      title: spec.title.trim(),
      tagline: spec.tagline.trim() || taglineFrom(answers.about),
      image_url: cleanImageUrl(spec.image_url),
      body,
      pronunciations,
    };
  }

  async function importFile(file: File) {
    setNotice(null);
    const { spec: parsed, errors: errs } = parseShowMd(await file.text());
    setDirty(true);
    setSpec(parsed);
    setAnswers(EMPTY_ANSWERS);
    setRawBody(parsed.body);
    setMoreOpen(true);
    setPronText(
      parsed.pronunciations.map((p) => `${p.term} => ${p.say_as}${p.match === "substring" ? " (substring)" : ""}`).join("\n"),
    );
    setErrors(errs.map(friendly));
    if (!errs.length) setNotice(`Filled in from ${file.name}. Check it over, then press Create show.`);
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
    setErrors(errs.map(friendly));
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
      if (!res.ok) throw new Error((data.errors || [data.error || "Couldn't create the show"]).join("\n"));
      localStorage.removeItem(DRAFT_KEY);
      setDirty(false);
      router.push(`/shows/${data.show.id}`);
    } catch (err) {
      setErrors((err instanceof Error ? err.message : String(err)).split("\n").map(friendly));
    } finally {
      setBusy(false);
    }
  }

  const lengths = LENGTHS.includes(spec.target_minutes) ? LENGTHS : [...LENGTHS, spec.target_minutes].sort((a, b) => a - b);

  return (
    <div className="panel">
      <h2>Start a new show</h2>
      <p className="muted">Answer a few questions. You can change any of it later.</p>
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
        <label htmlFor="spec-title">1. What&apos;s your show called?</label>
        <input
          id="spec-title"
          value={spec.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Diamond Hands"
          required
        />

        <label htmlFor="spec-about">2. What&apos;s it about?</label>
        <textarea
          id="spec-about"
          rows={4}
          value={answers.about}
          onChange={(e) => answer("about", e.target.value)}
          disabled={rawBody !== null}
          placeholder="e.g. A daily rundown of what moved the stock market, plus the meme-stock rumors everyone's talking about."
        />
        <p className="muted" style={{ marginTop: 4 }}>
          {rawBody !== null
            ? "You're using the full show brief under More options."
            : "A sentence or two is enough. More detail makes better episodes."}
        </p>

        <label htmlFor="spec-audience">3. Who&apos;s it for?</label>
        <input
          id="spec-audience"
          value={answers.audience}
          onChange={(e) => answer("audience", e.target.value)}
          disabled={rawBody !== null}
          placeholder="e.g. Casual investors who don't watch the market all day"
        />

        <label htmlFor="spec-tone">4. How should it sound?</label>
        <input
          id="spec-tone"
          value={answers.tone}
          onChange={(e) => answer("tone", e.target.value)}
          disabled={rawBody !== null}
          placeholder="e.g. Casual and funny, like two friends talking"
        />
        {rawBody === null ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {TONE_IDEAS.map((idea) => (
              <button key={idea} type="button" className="secondary" onClick={() => answer("tone", idea)}>
                {idea}
              </button>
            ))}
          </div>
        ) : null}

        <div className="row">
          <div>
            <label htmlFor="spec-cadence">5. How often?</label>
            <select
              id="spec-cadence"
              value={spec.cadence}
              onChange={(e) => set("cadence", e.target.value as ShowSpec["cadence"])}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {CADENCE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          {spec.cadence !== "manual" ? (
            <div>
              <label htmlFor="spec-time">At what time?</label>
              <input
                id="spec-time"
                type="time"
                value={spec.schedule_time}
                onChange={(e) => set("schedule_time", e.target.value)}
              />
            </div>
          ) : null}
          <div>
            <label htmlFor="spec-minutes">6. How long?</label>
            <select
              id="spec-minutes"
              value={spec.target_minutes}
              onChange={(e) => set("target_minutes", Number(e.target.value))}
            >
              {lengths.map((m) => (
                <option key={m} value={m}>
                  About {m} minutes
                </option>
              ))}
            </select>
          </div>
        </div>
        {spec.cadence !== "manual" ? (
          <p className="muted" style={{ marginTop: 4 }}>
            {spec.cadence === "twice_daily" ? "Twice a day means this time and 12 hours later. " : ""}
            Times are in {spec.timezone}.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 4 }}>Manual means episodes are made only when you press Generate.</p>
        )}

        <details open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)} style={{ marginTop: 16 }}>
          <summary>More options (all optional)</summary>

          <label htmlFor="spec-tagline">Motto</label>
          <input
            id="spec-tagline"
            value={spec.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder={taglineFrom(answers.about) || "e.g. Markets in five minutes."}
          />
          <p className="muted" style={{ marginTop: 4 }}>
            A short line shown under the show&apos;s name. Leave it blank and we&apos;ll use your first sentence.
          </p>

          <div className="row">
            <div>
              <label htmlFor="spec-host">Host name</label>
              <input id="spec-host" value={host(0).name} onChange={(e) => setHost(0, "name", e.target.value)} />
            </div>
            <div>
              <label htmlFor="spec-host2">Second host</label>
              <input id="spec-host2" value={host(1).name} onChange={(e) => setHost(1, "name", e.target.value)} />
            </div>
            <div>
              <label htmlFor="spec-voice">Voice</label>
              <input
                id="spec-voice"
                value={host(0).voice}
                onChange={(e) => setHost(0, "voice", e.target.value)}
                placeholder="default"
              />
            </div>
          </div>

          <div className="row">
            <div>
              <label htmlFor="spec-narration">Who reads it?</label>
              <select
                id="spec-narration"
                value={spec.narration_mode}
                onChange={(e) => set("narration_mode", e.target.value as ShowSpec["narration_mode"])}
              >
                <option value="auto">The app reads it aloud</option>
                <option value="external">I&apos;ll record it myself</option>
              </select>
            </div>
            <div>
              <label htmlFor="spec-tz">Time zone</label>
              <input id="spec-tz" value={spec.timezone} onChange={(e) => set("timezone", e.target.value)} />
            </div>
          </div>

          <label htmlFor="spec-pron">Say it right (one per line: WORD =&gt; how to say it)</label>
          <textarea
            id="spec-pron"
            rows={3}
            value={pronText}
            onChange={(e) => {
              setDirty(true);
              setPronText(e.target.value);
            }}
            placeholder={"FOMC => F O M C\n0DTE => zero D T E"}
          />

          <label htmlFor="spec-body">Full show brief</label>
          <textarea
            id="spec-body"
            rows={10}
            value={body}
            onChange={(e) => {
              setDirty(true);
              setRawBody(e.target.value);
            }}
          />
          <p className="muted" style={{ marginTop: 4 }}>
            This is what the host reads before every episode. It&apos;s built from your answers; editing it here
            replaces them.{" "}
            {rawBody !== null ? (
              <button type="button" className="linklike" onClick={() => setRawBody(null)}>
                Go back to my answers
              </button>
            ) : (
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  setDirty(true);
                  setRawBody([composeBody(answers), BODY_TEMPLATE].filter(Boolean).join("\n\n"));
                }}
              >
                Add the detailed template (segments, sources, rules)
              </button>
            )}
          </p>

          <p className="muted" style={{ marginTop: 12 }}>
            Show file (.md): a copy of everything on this page that you can keep or reuse.{" "}
            <button type="button" className="linklike" onClick={() => fileRef.current?.click()}>
              Fill in from a show file
            </button>{" "}
            ·{" "}
            <button type="button" className="linklike" onClick={download}>
              Save a copy as a file
            </button>
          </p>
        </details>

        {errors.length ? (
          <ul className="error">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}
        {notice ? (
          <p className="muted">
            {notice}{" "}
            {dirty ? (
              <button type="button" className="linklike" onClick={startOver}>
                Start over
              </button>
            ) : null}
          </p>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <button type="submit" disabled={busy || !spec.title.trim()}>
            {busy ? "Creating…" : "Create show"}
          </button>
        </div>
      </form>
    </div>
  );
}
