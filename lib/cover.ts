// Free, generated cover art: every show gets one made from its name, so no
// borrowed images. Owners can upload their own (lib/cover-upload.ts). Pure helpers; the PNG is drawn by
// app/art/[id]/route.tsx.

import { isTrustedArtworkUrl } from "@/lib/show-image";
import { isUploadedCoverPath } from "@/lib/cover-upload";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export const COVER_STAMP_SCALE = 0.18;
export const COVER_STAMP_MARGIN = 0.04;
const COVER_STAMP = readFileSync(join(process.cwd(), "public/brand/neon-logo-orbit-still.png"));

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
// Only links on NEON's own sites are used; anything else stored earlier falls
// back to the free cover, so no outside picture reaches a public feed.
// A cover an owner uploaded is served by /art/[id] itself.
export function artworkPath(show: { id: string; title: string; image_url?: string | null }): string {
  if (isTrustedArtworkUrl(show.image_url) || isUploadedCoverPath(show.id, show.image_url)) return show.image_url as string;
  return `/art/${show.id}?v=${hashString(`${show.title}:stamp-v1`).toString(36)}`;
}

export async function hasOfficialCoverStamp(input: Buffer): Promise<boolean> {
  const image = sharp(input, { limitInputPixels: 10_000_000 }).rotate();
  const { width, height } = await image.metadata();
  if (!width || width !== height) return false;
  const size = Math.round(width * COVER_STAMP_SCALE);
  const inset = Math.round(width * COVER_STAMP_MARGIN);
  const left = width - size - inset;
  const top = height - size - inset;
  const [coverPixels, markPixels] = await Promise.all([
    image.extract({ left, top, width: size, height: size }).ensureAlpha().raw().toBuffer(),
    sharp(COVER_STAMP).resize(size, size).ensureAlpha().raw().toBuffer(),
  ]);
  let error = 0;
  let compared = 0;
  for (let i = 0; i < markPixels.length; i += 4) {
    if (markPixels[i + 3] < 240) continue;
    error += Math.abs(coverPixels[i] - markPixels[i]);
    error += Math.abs(coverPixels[i + 1] - markPixels[i + 1]);
    error += Math.abs(coverPixels[i + 2] - markPixels[i + 2]);
    compared += 3;
  }
  return compared > 0 && error / compared < 28;
}

export async function stampOfficialCover(input: Buffer): Promise<Buffer> {
  const image = sharp(input, { limitInputPixels: 10_000_000 }).rotate();
  const { width, height } = await image.metadata();
  if (!width || width !== height) throw new Error("NEON cover art must be square before stamping.");
  const size = Math.round(width * COVER_STAMP_SCALE);
  const inset = Math.round(width * COVER_STAMP_MARGIN);
  const marked = await hasOfficialCoverStamp(input);
  const output = marked
    ? image
    : image.composite([{
        input: await sharp(COVER_STAMP).resize(size, size).png().toBuffer(),
        left: width - size - inset,
        top: height - size - inset,
      }]);
  return output.jpeg({ quality: 90 }).toBuffer();
}
