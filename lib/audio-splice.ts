// One-sentence edit for an episode that already has audio.
//
// The voice services we use return plain mp3 bytes — no per-sentence
// timestamps. So the edit point is STUBBED: we split the stored script into
// sentences, count words, and put the boundary where that sentence falls in the
// audio (using the real file length when ffprobe is available). Only the edited
// sentence and everything after it is re-read; ffmpeg joins the untouched head
// to that new tail with a short crossfade.
//
// The estimate is not sample-accurate. A sentence with pauses, numbers or
// unusual pacing can move the join by a fraction of a second. When a provider
// starts returning word timestamps, feed them to `estimateSentenceTimes`
// instead of the word-count fallback; the splice itself does not change.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { estimateDurationSeconds } from "@/lib/tts";

const exec = promisify(execFile);
export const DEFAULT_CROSSFADE_SECONDS = 0.08;

export interface Sentence {
  index: number;
  /** Sentence text without its surrounding whitespace. */
  text: string;
  /** Character offsets into the original script, for rebuilding it. */
  start: number;
  end: number;
}

export interface TimeSpan {
  start: number;
  end: number;
}

// Common abbreviations should not end a sentence. Their period is kept and
// the following words become part of the same pickable sentence.
const ABBREVIATION = /^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)\.$/i;
const SINGLE_INITIAL = /^\p{Lu}\.$/u;

// Split on sentence-ending punctuation while keeping the exact character
// offsets, so a corrected sentence can be written back without touching the
// rest of the transcript.
export function splitIntoSentences(script: string): Sentence[] {
  const found: Sentence[] = [];
  // A period only ends a sentence at whitespace or the end of the line, so
  // decimals (3.5) and initials (U.S.) stay inside one sentence.
  const re = /[^\n]+?(?:[.!?]+(?:["'”’)\]]*)(?=\s|$)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(script)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (!text) continue;
    const start = match.index + leading;
    found.push({ index: found.length, text, start, end: start + text.length });
  }

  for (let i = found.length - 1; i > 0; i--) {
    if (
      (ABBREVIATION.test(found[i - 1].text) || SINGLE_INITIAL.test(found[i - 1].text)) &&
      /^[\p{Lu}]/u.test(found[i].text)
    ) {
      const merged: Sentence = {
        index: found[i - 1].index,
        text: script.slice(found[i - 1].start, found[i].end).replace(/\s+/g, " ").trim(),
        start: found[i - 1].start,
        end: found[i].end,
      };
      found.splice(i - 1, 2, merged);
    }
  }
  return found.map((s, i) => ({ ...s, index: i }));
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
}

/**
 * Stubbed per-sentence timing: share the audio length out by word count.
 * `totalSeconds` should be the measured mp3 duration when it is available.
 */
export function estimateSentenceTimes(sentences: Sentence[], totalSeconds?: number): TimeSpan[] {
  const counts = sentences.map((s) => Math.max(1, wordCount(s.text)));
  const totalWords = counts.reduce((sum, n) => sum + n, 0);
  const seconds = totalSeconds && totalSeconds > 0
    ? totalSeconds
    : estimateDurationSeconds(sentences.map((s) => s.text).join(" "));
  let at = 0;
  return counts.map((count) => {
    const start = at;
    at += (seconds * count) / totalWords;
    return { start, end: at };
  });
}

export function estimateSentenceStart(sentences: Sentence[], index: number, totalSeconds?: number): number {
  return estimateSentenceTimes(sentences, totalSeconds)[index]?.start ?? 0;
}

/** Replace one sentence in the stored script, leaving all other bytes alone. */
export function rebuildScript(script: string, sentences: Sentence[], index: number, text: string): string {
  const sentence = sentences[index];
  if (!sentence) return script;
  const clean = text.replace(/\s+/g, " ").trim();
  return `${script.slice(0, sentence.start)}${clean}${script.slice(sentence.end)}`;
}

/** The part of the script that gets re-read: the edited sentence to the end. */
export function tailScript(sentences: Sentence[], index: number, text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return [clean, ...sentences.slice(index + 1).map((s) => s.text)].join(" ");
}

/** Real mp3 length when ffprobe is installed; null when it is not. */
export async function probeMp3Duration(audio: Buffer): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), "neon-probe-"));
  try {
    const file = join(dir, "audio.mp3");
    await writeFile(file, audio);
    const { stdout } = await exec(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { timeout: 30_000 },
    );
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Keep the original audio up to the (estimated) sentence boundary and join it
 * to the freshly read tail. ffmpeg does the trim + acrossfade; nothing is
 * written to storage until this returns.
 */
export async function spliceAudio({
  original,
  replacement,
  boundarySeconds,
  crossfadeSeconds = DEFAULT_CROSSFADE_SECONDS,
}: {
  original: Buffer;
  replacement: Buffer;
  boundarySeconds: number;
  crossfadeSeconds?: number;
}): Promise<Buffer> {
  if (!Number.isFinite(boundarySeconds) || boundarySeconds <= 0) throw new Error("Invalid splice boundary");
  if (!original.length || !replacement.length) throw new Error("Missing audio for splice");
  const fade = Math.max(0, Math.min(crossfadeSeconds, 0.5));
  // If the sentence is the first one (or the estimate is very early), there is
  // no head to crossfade — the new reading is the whole episode.
  if (fade === 0 || boundarySeconds <= fade) return Buffer.from(replacement);

  const dir = await mkdtemp(join(tmpdir(), "neon-splice-"));
  try {
    const head = join(dir, "original.mp3");
    const tail = join(dir, "replacement.mp3");
    const out = join(dir, "spliced.mp3");
    await writeFile(head, original);
    await writeFile(tail, replacement);

    // Extend the head by half the fade so the transition straddles the
    // estimated boundary rather than cutting exactly on it.
    const headEnd = (boundarySeconds + fade / 2).toFixed(3);
    const filter = [
      `[0:a]aresample=44100,aformat=channel_layouts=mono,atrim=0:${headEnd},asetpts=PTS-STARTPTS[head]`,
      "[1:a]aresample=44100,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[tail]",
      `[head][tail]acrossfade=d=${fade.toFixed(3)}:c1=tri:c2=tri[out]`,
    ].join(";");

    await exec("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", head, "-i", tail,
      "-filter_complex", filter,
      "-map", "[out]", "-vn",
      "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", out,
    ], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    return await readFile(out);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`ffmpeg splice failed: ${detail.slice(0, 300)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
