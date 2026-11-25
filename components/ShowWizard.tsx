"use client";

// Mobile-first, one-question-per-page new-show wizard. Each screen is small,
// finger-friendly and carries Skip + Back + Next. Save is enabled from the
// first step so progress isn't lost to a closed tab. On finish the show is
// created with just what's been answered; the rest goes on the Change-setup
// page. This is slice 1 (name, how many hosts, format); the content, format
// branches, episode shape and schedule screens come in later slices.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SHOW_FORMATS, type ShowFormat } from "@/lib/show-formats";

const DRAFT_KEY = "neon.wizard.draft.v1";

interface Draft {
  title: string;
  host_count: 1 | 2;
  format: string;
  step: number;
}

const EMPTY: Draft = { title: "", host_count: 1, format: "", step: 0 };

export default function ShowWizard() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

  // Autosave the draft so a closed tab doesn't lose progress.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setDraft({ ...EMPTY, ...JSON.parse(raw) });
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
  }, [draft, loaded]);
  useEffect(() => {
    firstInput.current?.focus();
  }, [draft.step]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const steps = [
    { id: "title", render: () => (
      <StepName value={draft.title} onChange={(v) => set("title", v)} inputRef={firstInput as React.RefObject<HTMLInputElement>} />
    ), canNext: draft.title.trim().length > 0, required: true },
    { id: "hosts", render: () => (
      <StepHostCount value={draft.host_count} onChange={(v) => set("host_count", v)} />
    ), canNext: true, required: false },
    { id: "format", render: () => (
      <StepFormat value={draft.format} onChange={(v) => set("format", v)} />
    ), canNext: true, required: false },
  ];

  const step = steps[draft.step];
  const last = draft.step === steps.length - 1;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const format = SHOW_FORMATS.find((f) => f.id === draft.format);
      const body = {
        spec: {
          title: draft.title.trim(),
          tagline: "",
          hosts: [{ name: format?.defaultHostName ?? "", voice: format?.defaultVoice ?? "" }],
          // host_count=2 is remembered for a later slice that asks the second host's name.
          cadence: "manual",
          schedule_time: "08:00",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
          target_minutes: 10,
          language: "en",
          explicit: false,
          narration_mode: "auto",
          image_url: "",
          body: "",
          pronunciations: [],
        },
      };
      const res = await fetch("/api/shows/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That didn't save. Try again.");
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      router.push(`/shows/${data.show.id}/edit?from=wizard`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard">
      <WizardProgress current={draft.step + 1} total={steps.length} />
      <div className="wizard-card">{step.render()}</div>
      {error ? <p className="error">{error}</p> : null}
      <div className="wizard-nav">
        <button
          type="button"
          className="btn secondary"
          onClick={() => set("step", Math.max(0, draft.step - 1))}
          disabled={draft.step === 0 || busy}
        >
          Back
        </button>
        {!step.required ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => last ? void finish() : set("step", draft.step + 1)}
            disabled={busy}
          >
            Skip for now
          </button>
        ) : null}
        {last ? (
          <button type="button" className="btn primary" disabled={!step.canNext || busy} onClick={() => void finish()}>
            {busy ? "Saving..." : "Create show"}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={!step.canNext || busy} onClick={() => set("step", draft.step + 1)}>
            Next
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 13, textAlign: "center" }}>
        Your answers save as you go. Three free changes after the show is made.
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

function StepName({ value, onChange, inputRef }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  return (
    <>
      <h2>What's your show called?</h2>
      <p className="muted">You can change it later.</p>
      <input
        ref={inputRef}
        className="wizard-input"
        value={value}
        placeholder="e.g. Sunday Morning Markets"
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        maxLength={120}
      />
    </>
  );
}

function StepHostCount({ value, onChange }: { value: 1 | 2; onChange: (v: 1 | 2) => void }) {
  return (
    <>
      <h2>How many hosts?</h2>
      <p className="muted">One is simpler; two sound like a conversation.</p>
      <div className="wizard-choices">
        <WizardChoice selected={value === 1} onClick={() => onChange(1)} title="One host" sub="Solo narration." />
        <WizardChoice selected={value === 2} onClick={() => onChange(2)} title="Two hosts" sub="Back and forth." />
      </div>
    </>
  );
}

function StepFormat({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <h2>What kind of show?</h2>
      <p className="muted">Pick what's closest. You can change it later.</p>
      <div className="wizard-choices">
        {SHOW_FORMATS.map((f: ShowFormat) => (
          <WizardChoice key={f.id} selected={value === f.id} onClick={() => onChange(f.id)} title={f.label} sub={f.description} />
        ))}
      </div>
    </>
  );
}

function WizardChoice({ selected, onClick, title, sub }: { selected: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button type="button" className={`wizard-choice${selected ? " wizard-choice-selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      <span className="wizard-choice-title">{title}</span>
      <span className="wizard-choice-sub">{sub}</span>
    </button>
  );
}
