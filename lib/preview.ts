// The wizard's first-episode paragraph is a short, format-specific template;
// only TTS is needed, and re-voicing the cached paragraph costs no writer call.
// Import-free so tests can load it directly.

export const PREVIEW_WORDS = 150; // ~60 seconds at 150 words a minute
export const MAX_PREVIEW_CHARS = 1200;
export const PREVIEWS_PER_DAY = 5;

export function previewScript(opts: {
  showTitle: string;
  hostName: string;
  format: string;
  about: string;
}): string {
  const title = spoken(opts.showTitle, 100) || "Your new show";
  const host = spoken(opts.hostName, 60) || "your host";
  const about = spoken(opts.about, 240).replace(/[.!?]+$/, "") || "the stories and questions that matter to its listeners";
  const openings: Record<string, string> = {
    news: "We’ll start with what is confirmed, put it in context, and be clear about what is still unknown.",
    markets: "We’ll look at what moved, what drove it, and which signals matter beyond today’s headlines.",
    history: "We’ll follow the people, place, and choices that shaped this story, then look at what lasted.",
    talk: "We’ll bring the week’s questions into a thoughtful conversation and let different views meet.",
    truecrime: "We’ll examine the record carefully, distinguish evidence from allegation, and treat the people involved with care.",
    madeup: "We’ll step into a new story, meet its characters, and follow the first choice that changes their world.",
    other: "We’ll begin with the central idea and work through the questions that make it worth your time.",
  };
  const firstParagraph = [
    `Welcome to ${title}. I’m ${host}.`,
    openings[opts.format] || openings.other,
    `This show is about ${about}.`,
    "We’ll take the subject one piece at a time: first a clear starting point, then the details that matter, and finally the wider picture. Each part should be easy to follow, and together they should give us a stronger understanding of the story. We’ll explain unfamiliar terms as they come up, keep the pace steady, and leave room for what we do not yet know. You do not need special background to join in; we’ll build the context step by step and focus on the questions that deserve a closer look. By the end, you’ll have a useful account of the subject, why it matters, and what to watch or think about next. Let’s begin.",
  ].join(" ");
  return cleanPreviewScript(firstParagraph);
}

function spoken(value: string, max: number): string {
  return (value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Tidy what the model returned and cap it, cutting at a sentence end when one
// is close, so the voice service never gets more than MAX_PREVIEW_CHARS.
export function cleanPreviewScript(raw: string): string {
  let t = (raw || "")
    .replace(/```[a-z]*\n?|```/gi, "")
    .replace(/^\s*(?:host|narrator)\s*:\s*/i, "")
    .replace(/\[[^\]]*\]|\([^)]*(?:music|sound|sfx|pause)[^)]*\)/gi, "")
    .replace(/[*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/^["“]+|["”]+$/g, "").trim();
  if (t.length <= MAX_PREVIEW_CHARS) return t;
  const cut = t.slice(0, MAX_PREVIEW_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end > MAX_PREVIEW_CHARS * 0.5) return cut.slice(0, end + 1).trim();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trim() + ".";
}

// One counter per user per UTC day, kept in app_settings (no migration).
export function previewCounterKey(userId: string, now: Date): string {
  return `preview_uses:${userId}:${now.toISOString().slice(0, 10)}`;
}

// Settings → Voice "Hear it": a fixed ~5-second line, so auditioning a voice
// costs only the voice (no writer call). Uses the name before " - " in the
// catalog label ("Ryan - British man, newsreader" → "Ryan").
export function voiceSampleLine(label: string): string {
  const name = (label || "").split(" - ")[0].trim();
  return name
    ? `Hi, I'm ${name}. This is how I'd sound reading your show on NEON.`
    : "Hi. This is how I'd sound reading your show on NEON.";
}
