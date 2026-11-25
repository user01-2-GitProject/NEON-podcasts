"use client";

// Mobile-first, one-question-per-page new-show wizard. Every question lives
// in lib/wizard-steps.ts, so adding or trimming questions never touches this
// file. Each screen is small, finger-friendly and carries Back + Skip +
// Next; Save goes to localStorage on every keystroke so a closed tab
// doesn't lose progress. Finish creates the show from the answers and
// redirects to Change-setup where the owner can keep editing.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SHOW_FORMATS } from "@/lib/show-formats";
import { OPENAI_VOICE_OPTIONS } from "@/lib/voices";
import {
  EMPTY_WIZARD,
  WIZARD_STEPS,
  cadenceFromAnswer,
  composeWizardBody,
  formatIdFromLabel,
  minutesFromLengthAnswer,
  visibleSteps,
  type WizardDraft,
  type WizardStep,
} from "@/lib/wizard-steps";

const DRAFT_KEY = "neon.wizard.draft.v2";

export default function ShowWizard() {
  const router = useRouter();
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_WIZARD);
  const [stepIdx, setStepIdx] = useState(0);
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

  const steps = useMemo(() => visibleSteps(draft), [draft]);
  const clampedIdx = Math.min(stepIdx, steps.length - 1);
  const step = steps[clampedIdx];

  useEffect(() => {
    firstInput.current?.focus();
  }, [clampedIdx, step?.id]);

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

  const last = clampedIdx === steps.length - 1;
  const canNext = step?.required ? valueFor(step).trim().length > 0 : true;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const format = SHOW_FORMATS.find((f) => f.id === draft.format);
      const voice = format?.defaultVoice && OPENAI_VOICE_OPTIONS.some((v) => v.id === format.defaultVoice) ? format.defaultVoice : "";
      // Hosts must have a name (lib/show-spec.ts validateShowSpec), and the wizard
      // doesn't ask for the second host's name yet, so we give sensible fallbacks.
      const firstName = format?.defaultHostName || "Host";
      const hosts = draft.host_count === 2
        ? [{ name: firstName, voice }, { name: "Co-host", voice: "" }]
        : [{ name: firstName, voice }];
      const cadence = cadenceFromAnswer(draft.answers.cadence);
      const body = composeWizardBody(draft);
      const spec = {
        title: draft.title.trim(),
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
      // Honor "Make the first full episode now?" by kicking off a generation
      // before the redirect. Any failure here is reported on the show page
      // (the Runs panel) rather than blocking the redirect.
      if (draft.answers.preview === "yes") {
        void fetch(`/api/shows/${data.show.id}/generate`, { method: "POST" });
      }
      router.push(`/shows/${data.show.id}?from=wizard`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!step) return <p className="muted">Loading…</p>;

  return (
    <div className="wizard">
      <WizardProgress current={clampedIdx + 1} total={steps.length} />
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
            onClick={() => (last ? void finish() : setStepIdx(clampedIdx + 1))}
            disabled={busy}
          >
            Skip for now
          </button>
        ) : null}
        {last ? (
          <button type="button" className="btn primary" disabled={!canNext || busy} onClick={() => void finish()}>
            {busy ? "Saving…" : "Create show"}
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
        <button type="button" className="linklike" onClick={() => void finish()} disabled={busy}>
          Create show now and finish the rest later
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
          maxLength={200}
        />
      ) : step.type === "textarea" ? (
        <textarea
          ref={(el) => { firstRef.current = el; }}
          className="wizard-input"
          rows={5}
          value={value}
          placeholder={step.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={2000}
        />
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
