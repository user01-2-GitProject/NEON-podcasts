"use client";

// Mobile-first, one-question-per-page new-show wizard. Every question lives
// in lib/wizard-steps.ts, so adding or trimming questions never touches this
// file. Each screen is small, finger-friendly and carries Back + Skip +
// Next; Save goes to localStorage on every keystroke so a closed tab
// doesn't lose progress.
//
// The walk is grouped into tabs (Show / Host 1 / Host 2 if two hosts), with a
// review screen at the very end showing every filled answer as a one-sentence
// preview. Create requires a two-click confirm ("are you sure?") because
// changes after Create start costing money. Finish creates the show from
// the answers and redirects to the show page, whose Edit show button keeps
// editing.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SHOW_FORMATS } from "@/lib/show-formats";
import { OPENAI_VOICE_OPTIONS } from "@/lib/voices";
import {
  EMPTY_WIZARD,
  brandedTitle,
  cadenceFromAnswer,
  composeWizardBody,
  formatIdFromLabel,
  grayedChoices,
  minutesFromLengthAnswer,
  readMulti,
  reviewLines,
  stepsByTab,
  writeMulti,
  type WizardDraft,
  type WizardStep,
} from "@/lib/wizard-steps";

const DRAFT_KEY = "neon.wizard.draft.v2";

export default function ShowWizard() {
  const router = useRouter();
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_WIZARD);
  const [stepIdx, setStepIdx] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { draft?: WizardDraft; stepIdx?: number };
        if (saved.draft) setDraft({ ...EMPTY_WIZARD, ...saved.draft, answers: { ...EMPTY_WIZARD.answers, ...saved.draft.answers } });
        if (typeof saved.stepIdx === "number") setStepIdx(saved.stepIdx);
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, stepIdx })); } catch {}
  }, [draft, stepIdx, loaded]);

  // Flatten the tab/step tree into one ordered list; each slot carries the
  // tab it belongs to so the header can say "Show · 5 of 20".
  const tabs = useMemo(() => stepsByTab(draft), [draft]);
  const flat = useMemo(() => tabs.flatMap((t) => t.steps.map((s) => ({ step: s, tab: t.tab }))), [tabs]);
  const clampedIdx = Math.min(stepIdx, Math.max(0, flat.length - 1));
  const slot = flat[clampedIdx];
  const step = slot?.step;
  const tabInfo = slot?.tab;

  // Position within the current tab, for the "Show · 5 of 20" header.
  const posInTab = useMemo(() => {
    if (!tabInfo) return { current: 0, total: 0 };
    const sameTab = flat.filter((f) => f.tab.id === tabInfo.id);
    const idx = sameTab.findIndex((f) => f.step === step);
    return { current: idx + 1, total: sameTab.length };
  }, [flat, tabInfo, step]);

  useEffect(() => {
    firstInput.current?.focus();
  }, [clampedIdx, step?.id, reviewing]);

  function setAnswer(id: string, value: string) {
    if (id === "title") setDraft((d) => ({ ...d, title: value }));
    else if (id === "format") setDraft((d) => ({ ...d, format: formatIdFromLabel(value), answers: { ...d.answers, format: value } }));
    else if (id === "host_count") setDraft((d) => ({ ...d, host_count: value === "Two hosts" ? 2 : 1, answers: { ...d.answers, host_count: value } }));
    else setDraft((d) => ({ ...d, answers: { ...d.answers, [id]: value } }));
  }
  function valueFor(step: WizardStep): string {
    if (step.id === "title") return draft.title;
    return draft.answers[step.id] ?? "";
  }

  const atLastStep = clampedIdx === flat.length - 1;
  const canNext = step?.required ? valueFor(step).trim().length > 0 : true;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const format = SHOW_FORMATS.find((f) => f.id === draft.format);
      const voice = format?.defaultVoice && OPENAI_VOICE_OPTIONS.some((v) => v.id === format.defaultVoice) ? format.defaultVoice : "";
      // Hosts must have a name (lib/show-spec.ts validateShowSpec); the wizard
      // doesn't ask for the second host's name yet, so we give sensible fallbacks.
      const firstName = format?.defaultHostName || "Host";
      const hosts = draft.host_count === 2
        ? [{ name: firstName, voice }, { name: "Co-host", voice: "" }]
        : [{ name: firstName, voice }];
      const cadence = cadenceFromAnswer(draft.answers.cadence);
      const body = composeWizardBody(draft);
      const spec = {
        // "N.E.O.N. - " prefix is hardcoded so every show carries the brand
        // through to Apple and Spotify (jimmy + Matt, Nov 25).
        title: brandedTitle(draft.title),
        tagline: "",
        hosts,
        cadence,
        schedule_time: draft.answers.schedule_time?.trim() || "08:00",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
        target_minutes: minutesFromLengthAnswer(draft.answers.length, 10),
        language: "en",
        explicit: /explicit/i.test(draft.answers.explicit || ""),
        narration_mode: "auto",
        image_url: "",
        body,
        pronunciations: [],
      };
      const res = await fetch("/api/shows/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That didn't save. Try again.");
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      // Honor "Make the first full episode now?" from the review screen.
      // Failure here is reported on the show page (Runs panel), not here.
      if (draft.answers.preview === "yes") {
        void fetch(`/api/shows/${data.show.id}/generate`, { method: "POST" });
      }
      router.push(`/shows/${data.show.id}?from=wizard`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="muted">Loading…</p>;

  // ---- Review phase: shown after the last step. ----
  if (reviewing) {
    const lines = reviewLines(draft);
    const previewAnswer = draft.answers.preview ?? "";
    return (
      <div className="wizard">
        <div className="wizard-tab-header">
          <span className="wizard-tab-label">Review</span>
          <span className="wizard-tab-pos muted">Last stop before Create</span>
        </div>
        <div className="wizard-card">
          <h2>Your show so far</h2>
          <p className="muted">
            It'll be called <strong>{brandedTitle(draft.title || "(untitled)")}</strong>.
            Tap <em>Back</em> to change anything, or create the show below.
          </p>
          {lines.length ? (
            <dl className="wizard-review">
              {lines.map(({ step, line }) => (
                <div key={step.id} className="wizard-review-row">
                  <dt>{step.question}</dt>
                  <dd>{line}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">You skipped every question — we'll use sensible defaults.</p>
          )}
          <hr style={{ margin: "16px 0", borderColor: "rgba(255,255,255,0.08)" }} />
          <h3 style={{ marginTop: 0 }}>Make the first full episode now?</h3>
          <p className="muted">You can also do this later from the show page.</p>
          <div className="wizard-choices wizard-choices-row">
            {["yes", "no"].map((c) => (
              <button
                key={c}
                type="button"
                className={`wizard-choice${previewAnswer === c ? " wizard-choice-selected" : ""}`}
                aria-pressed={previewAnswer === c}
                onClick={() => setAnswer("preview", c)}
              >
                <span className="wizard-choice-title">{c === "yes" ? "Yes" : "No"}</span>
              </button>
            ))}
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="wizard-nav">
          <button type="button" className="btn secondary" disabled={busy} onClick={() => { setReviewing(false); setConfirming(false); }}>
            Back
          </button>
          {confirming ? (
            <>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void finish()}>
                {busy ? "Creating…" : "Yes, create it"}
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" disabled={busy || draft.title.trim().length === 0} onClick={() => setConfirming(true)}>
              Create show
            </button>
          )}
        </div>
        {confirming ? (
          <p className="muted" style={{ marginTop: 8, fontSize: 13, textAlign: "center" }}>
            Changes after Create start costing a bit per edit.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 8, fontSize: 13, textAlign: "center" }}>
            Three free changes after the show is made.
          </p>
        )}
      </div>
    );
  }

  // ---- Step phase. ----
  if (!step || !tabInfo) return <p className="muted">Loading…</p>;

  return (
    <div className="wizard">
      <div className="wizard-tab-header">
        <span className="wizard-tab-label">{tabInfo.label}</span>
        <span className="wizard-tab-pos muted">{posInTab.current} / {posInTab.total}</span>
      </div>
      <WizardProgress current={clampedIdx + 1} total={flat.length} />
      <div className="wizard-card">
        <StepView step={step} value={valueFor(step)} onChange={(v) => setAnswer(step.id, v)} firstRef={firstInput} />
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="wizard-nav">
        <button
          type="button"
          className="btn secondary"
          onClick={() => setStepIdx(Math.max(0, clampedIdx - 1))}
          disabled={clampedIdx === 0 || busy}
        >
          Back
        </button>
        {!step.required ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => (atLastStep ? setReviewing(true) : setStepIdx(clampedIdx + 1))}
            disabled={busy}
          >
            Skip for now
          </button>
        ) : null}
        {atLastStep ? (
          <button type="button" className="btn primary" disabled={!canNext || busy} onClick={() => setReviewing(true)}>
            Review and create
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={!canNext || busy} onClick={() => setStepIdx(clampedIdx + 1)}>
            Next
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 13, textAlign: "center" }}>
        Your answers save as you go. Three free changes after the show is made.
      </p>
      <p className="muted" style={{ marginTop: 4, fontSize: 12, textAlign: "center" }}>
        Done with the wizard?{" "}
        <button type="button" className="linklike" onClick={() => setReviewing(true)} disabled={busy}>
          Skip ahead to review
        </button>
        , or <Link href="/">cancel</Link>.
      </p>
    </div>
  );
}

function WizardProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="wizard-progress" aria-label={`Step ${current} of ${total}`}>
      <div className="wizard-progress-bar" style={{ width: `${(current / total) * 100}%` }} />
      <span className="wizard-progress-label">{current} / {total}</span>
    </div>
  );
}

function StepView({ step, value, onChange, firstRef }: {
  step: WizardStep;
  value: string;
  onChange: (v: string) => void;
  firstRef: React.MutableRefObject<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null>;
}) {
  const textareaMax = step.maxLength || 2000;
  const charsLeft = step.type === "textarea" && step.maxLength ? Math.max(0, step.maxLength - value.length) : null;
  return (
    <>
      <h2>{step.question}</h2>
      {step.help ? <p className="muted">{step.help}</p> : null}
      {step.type === "text" ? (
        <input
          ref={(el) => { firstRef.current = el; }}
          className="wizard-input"
          value={value}
          placeholder={step.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          maxLength={step.maxLength || 200}
        />
      ) : step.type === "textarea" ? (
        <>
          <textarea
            ref={(el) => { firstRef.current = el; }}
            className="wizard-input"
            rows={5}
            value={value}
            placeholder={step.placeholder || ""}
            onChange={(e) => onChange(e.target.value.slice(0, textareaMax))}
            maxLength={textareaMax}
          />
          {charsLeft !== null ? (
            <p className="muted" style={{ marginTop: 4, fontSize: 12, textAlign: "right" }}>
              {charsLeft.toLocaleString()} characters left
            </p>
          ) : null}
        </>
      ) : step.type === "choice" ? (
        <div className="wizard-choices">
          {(step.choices || []).map((c, i) => (
            <button
              key={c}
              ref={i === 0 ? ((el) => { firstRef.current = el; }) : undefined}
              type="button"
              className={`wizard-choice${value === c ? " wizard-choice-selected" : ""}`}
              aria-pressed={value === c}
              onClick={() => onChange(c)}
            >
              <span className="wizard-choice-title">{c}</span>
            </button>
          ))}
        </div>
      ) : step.type === "yesno" ? (
        <div className="wizard-choices wizard-choices-row">
          {["yes", "no"].map((c, i) => (
            <button
              key={c}
              ref={i === 0 ? ((el) => { firstRef.current = el; }) : undefined}
              type="button"
              className={`wizard-choice${value === c ? " wizard-choice-selected" : ""}`}
              aria-pressed={value === c}
              onClick={() => onChange(c)}
            >
              <span className="wizard-choice-title">{c === "yes" ? "Yes" : "No"}</span>
            </button>
          ))}
        </div>
      ) : step.type === "multi" ? (
        <div className="wizard-choices">
          {(() => {
            const picked = readMulti(value);
            const gray = new Set(grayedChoices(step, picked));
            return (step.choices || []).map((c, i) => {
              const isPicked = picked.includes(c);
              const isGray = !isPicked && gray.has(c);
              return (
                <button
                  key={c}
                  ref={i === 0 ? ((el) => { firstRef.current = el; }) : undefined}
                  type="button"
                  disabled={isGray}
                  className={`wizard-choice${isPicked ? " wizard-choice-selected" : ""}${isGray ? " wizard-choice-gray" : ""}`}
                  aria-pressed={isPicked}
                  onClick={() => {
                    const next = isPicked ? picked.filter((p) => p !== c) : [...picked, c];
                    onChange(writeMulti(next));
                  }}
                >
                  <span className="wizard-choice-title">{c}</span>
                </button>
              );
            });
          })()}
        </div>
      ) : step.type === "scale" ? (
        <div className="wizard-scale">
          <div className="wizard-scale-labels">
            <span>{step.minLabel || String(step.min ?? 1)}</span>
            <span>{step.maxLabel || String(step.max ?? 5)}</span>
          </div>
          <div className="wizard-scale-dots">
            {Array.from({ length: (step.max ?? 5) - (step.min ?? 1) + 1 }, (_, i) => (step.min ?? 1) + i).map((n, i) => (
              <button
                key={n}
                ref={i === 0 ? ((el) => { firstRef.current = el; }) : undefined}
                type="button"
                className={`wizard-scale-dot${value === String(n) ? " wizard-scale-dot-selected" : ""}`}
                onClick={() => onChange(String(n))}
                aria-label={`${n}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
