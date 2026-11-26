// Automatic episode titles. The writer always proposes a title with the script
// (lib/claude.ts); this tidies it so every episode in the app, the RSS feed
// and Apple/Spotify reads cleanly without the owner ever typing one:
//   - no show name or "N.E.O.N. -" brand prefix (the show title carries it),
//   - no "Episode 12:" / "Ep. 12 -" (the feed sends the number separately,
//     as Apple asks, in <itunes:episode>),
//   - no wrapping quotes, markdown or trailing period,
//   - at most MAX_TITLE_CHARS, cut on a word,
//   - never "Untitled": falls back to "<Show> for <date>".
// Import-free so tests can load it directly.

export const MAX_TITLE_CHARS = 80;

const PLACEHOLDER = /^(untitled( episode)?|episode|title|new episode)$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "N.E.O.N. - Sunday Markets" -> "Sunday Markets"
export function bareShowTitle(showTitle: string): string {
  return showTitle.replace(/^\s*N\.?\s*E\.?\s*O\.?\s*N\.?\s*(?:[-–—:|]\s*)?/i, "").trim();
}

export function cleanEpisodeTitle(raw: string | null | undefined, opts: { showTitle: string; dateLabel: string }): string {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  // Markdown leftovers: "# Title", "**Title**", `Title`.
  t = t.replace(/^#+\s*/, "").replace(/^\*\*(.*)\*\*$/, "$1").replace(/^`(.*)`$/, "$1").trim();
  // Wrapping quotes, straight or curly.
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  // A leading "Title:" label.
  t = t.replace(/^title\s*:\s*/i, "");

  // Show name / brand in front: "N.E.O.N. - Sunday Markets: Oil slides" -> "Oil slides".
  const show = bareShowTitle(opts.showTitle);
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(/^\s*N\.?\s*E\.?\s*O\.?\s*N\.?\s*(?:[-–—:|]\s*)?/i, "");
    if (show) t = t.replace(new RegExp(`^${escapeRe(show)}\\s*(?:[-–—:|,]\\s*)?`, "i"), "");
    t = t.replace(/^(?:episode|ep\.?)\s*#?\s*\d+\s*(?:[-–—:|.,]\s*)?/i, "");
    t = t.trim();
    if (t === before) break;
  }

  t = t.replace(/[.\s]+$/, "").trim();
  if (t.length > MAX_TITLE_CHARS) {
    const cut = t.slice(0, MAX_TITLE_CHARS + 1);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut.slice(0, MAX_TITLE_CHARS)).replace(/[\s,;:–—-]+$/, "") + "…";
  }
  if (!t || PLACEHOLDER.test(t)) {
    return `${show || "Episode"} for ${opts.dateLabel}`;
  }
  // Sentence-case the first letter only; keep the writer's casing otherwise.
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "Nov 26" in the show's own time zone.
export function shortDateLabel(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  }
}
