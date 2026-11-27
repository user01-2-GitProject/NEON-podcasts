// E6: the wizard's top strip in the NEON brand: the tab name in gold ink,
// where you are in that tab, and an antique-gold hairline that fills as you
// go. Colors come from the E1 tokens in app/globals.css.

export function WizardTabHeader({ label, position }: { label: string; position: string }) {
  return (
    <div className="wizard-tab-header">
      <span className="wizard-tab-label">{label}</span>
      <span className="wizard-tab-pos muted">{position}</span>
    </div>
  );
}

export function WizardProgress({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  return (
    <div
      className="wizard-progress"
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={`Step ${current} of ${total}`}
    >
      <div className="wizard-progress-bar" style={{ width: `${pct}%` }} />
      <span className="wizard-progress-label">{current} / {total}</span>
    </div>
  );
}
