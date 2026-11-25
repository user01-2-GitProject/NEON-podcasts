// Free, generated cover art: every show gets one made from its name, so no
// borrowed images and nothing to upload. Pure helpers; the PNG is drawn by
// app/art/[id]/route.tsx.

export interface CoverPalette {
  from: string;
  to: string;
  glow: string;
  angle: number;
}

const PALETTES: [string, string, string][] = [
  ["#12002b", "#3b0a6b", "#ff2bd6"],
  ["#001b2e", "#004e7a", "#00e5ff"],
  ["#1a0010", "#5c0030", "#ff5c8a"],
  ["#06140a", "#0f4d2a", "#39ff88"],
  ["#1c0f00", "#6b3a00", "#ffb020"],
  ["#0b0b2b", "#2a1f7a", "#8a7dff"],
  ["#00151a", "#00584f", "#2bffd5"],
  ["#1a0505", "#6b0f0f", "#ff4d3d"],
];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coverPalette(seed: string): CoverPalette {
  const h = hashString(seed);
  const [from, to, glow] = PALETTES[h % PALETTES.length];
  return { from, to, glow, angle: 90 + (h % 180) };
}

// Font size that keeps the title inside the square at 1400px.
export function coverFontSize(title: string): number {
  const longestWord = Math.max(1, ...title.split(/\s+/).map((w) => w.length));
  const byWord = Math.floor(1100 / (longestWord * 0.62));
  const byLength = title.length <= 12 ? 200 : title.length <= 24 ? 160 : title.length <= 48 ? 120 : 92;
  return Math.max(64, Math.min(byWord, byLength));
}

// Where a show's artwork lives: its own image if set, otherwise its generated
// cover. The version changes with the title so caches pick up renames.
export function artworkPath(show: { id: string; title: string; image_url?: string | null }): string {
  if (show.image_url && /^https?:\/\//i.test(show.image_url)) return show.image_url;
  return `/art/${show.id}?v=${hashString(show.title).toString(36)}`;
}
