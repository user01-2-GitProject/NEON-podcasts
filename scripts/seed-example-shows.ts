// Idempotent demo seed: two NEON-owned worked examples with baked audio.
// Usage: DATABASE_URL=... npm run seed:examples (run db:migrate first).
//
// Editorial copy comes from templates/examples/*.md (the same files the
// wizard examples are tested against); this script only maps it to show and
// episode columns. Stable ids make re-runs update the same rows.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql as defaultSql } from "@/lib/db";
import {
  parseShowMd,
  specToShowFields,
  validateShowSpec,
  type ShowSpec,
} from "@/lib/show-spec";
import { getStorage, type StorageProvider } from "@/lib/storage";
import {
  EXAMPLE_SHOWS,
  SYSTEM_OWNER,
  type ExampleShowDefinition,
} from "@/lib/example-shows";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const AUDIO_FIXTURE = "scripts/fixtures/example-silent-3min.mp3";
export const AUDIO_CONTENT_TYPE = "audio/mpeg";
export const DEMO_DURATION_SECONDS = 180;
// Fixed so a re-run does not change Browse ordering or RSS pub dates.
export const SEED_TIME = "2026-11-26T12:00:00Z";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface ExampleSeed {
  definition: ExampleShowDefinition;
  show: {
    id: string;
    ownerEmail: string;
    title: string;
    description: string;
    styleGuide: string;
    voiceId: string | null;
    narrationMode: string;
    cadence: string;
    airDays: number[] | null;
    scheduleTime: string;
    timezone: string;
    targetMinutes: number;
    rssToken: string;
  };
  episode: {
    id: string;
    title: string;
    script: string;
    showNotes: string;
    audioUrl: string;
    byteSize: number;
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function section(body: string, heading: string): string {
  const match = new RegExp(`## ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i").exec(body);
  return match?.[1]?.trim() || "";
}

function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] || "").trim();
}

// Show notes reuse the wizard example's own tagline and About section, so the
// seeded notes and the example the owner sees in the wizard can't drift.
export function notesFromSpec(spec: ShowSpec, formatLabel: string): string {
  const about = firstParagraph(section(spec.body, "About the show"));
  const parts = [
    spec.tagline.trim(),
    about ? `About: ${about}` : "",
    `This is a three-minute sample of the ${formatLabel} format. The audio is intentionally silent; the notes show what a listener would read under a finished episode.`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Pure mapping from a wizard example template to the rows we will insert. */
export function buildExampleSeed(
  definition: ExampleShowDefinition,
  templateText: string,
  byteSize: number,
  audioUrl: string,
): ExampleSeed {
  const { spec, errors } = parseShowMd(templateText);
  const problems = [...errors, ...validateShowSpec(spec)];
  if (problems.length) {
    throw new Error(`${definition.templatePath}: ${problems.join("; ")}`);
  }
  const fields = specToShowFields(spec);
  const notes = notesFromSpec(spec, definition.formatLabel);
  return {
    definition,
    show: {
      id: definition.id,
      ownerEmail: SYSTEM_OWNER.email,
      title: definition.title,
      description: fields.description,
      styleGuide: fields.style_guide,
      voiceId: fields.voice_id,
      narrationMode: fields.narration_mode,
      cadence: fields.cadence,
      airDays: fields.air_days,
      scheduleTime: fields.schedule_time,
      timezone: fields.timezone,
      targetMinutes: fields.target_minutes,
      rssToken: definition.rssToken,
    },
    episode: {
      id: definition.episodeId,
      title: definition.episodeTitle,
      script: notes,
      showNotes: notes,
      audioUrl,
      byteSize,
    },
  };
}

export async function seedExamples(opts: {
  db?: SqlFn;
  storage?: StorageProvider;
  rootDir?: string;
} = {}): Promise<ExampleSeed[]> {
  const db = (opts.db ?? defaultSql) as SqlFn;
  const storage = opts.storage ?? getStorage();
  const root = opts.rootDir ?? join(__dirname, "..");
  const bytes = readFileSync(join(root, AUDIO_FIXTURE));

  // Reserved system account: no password and not in OWNER_EMAILS, so nobody
  // can sign in as it. Examples only need a real users row for the FK.
  await db`
    insert into users (email, password_hash, role, owner_approved)
    values (${SYSTEM_OWNER.email}, null, ${SYSTEM_OWNER.role}, false)
    on conflict (email) do update set
      password_hash = null, role = excluded.role, owner_approved = false
  `;
  const users = (await db`
    select id from users where email = ${SYSTEM_OWNER.email} limit 1
  `) as { id: string }[];
  const ownerId = users[0]?.id;

  const seeded: ExampleSeed[] = [];
  for (const definition of EXAMPLE_SHOWS) {
    const seed = buildExampleSeed(
      definition,
      readFileSync(join(root, definition.templatePath), "utf8"),
      bytes.length,
      storage.url(definition.episodeId),
    );
    const { show, episode } = seed;

    await db`
      insert into shows (
        id, user_id, title, description, style_guide, voice_id, narration_mode,
        cadence, air_days, schedule_time, timezone, target_minutes, rss_token,
        is_public, is_official, is_active, created_at
      ) values (
        ${show.id}, ${ownerId}, ${show.title}, ${show.description}, ${show.styleGuide},
        ${show.voiceId}, ${show.narrationMode}, ${show.cadence}, ${show.airDays},
        ${show.scheduleTime}, ${show.timezone}, ${show.targetMinutes}, ${show.rssToken},
        true, true, false, ${SEED_TIME}
      )
      on conflict (id) do update set
        user_id = excluded.user_id,
        title = excluded.title,
        description = excluded.description,
        style_guide = excluded.style_guide,
        voice_id = excluded.voice_id,
        narration_mode = excluded.narration_mode,
        cadence = excluded.cadence,
        air_days = excluded.air_days,
        schedule_time = excluded.schedule_time,
        timezone = excluded.timezone,
        target_minutes = excluded.target_minutes,
        rss_token = excluded.rss_token,
        is_public = true,
        is_official = true,
        is_active = false
    `;

    await db`
      insert into episodes (
        id, show_id, title, script, show_notes, audio_url, duration_seconds,
        byte_size, audio_content_type, status, published_at, created_at
      ) values (
        ${episode.id}, ${show.id}, ${episode.title}, ${episode.script}, ${episode.showNotes},
        ${episode.audioUrl}, ${DEMO_DURATION_SECONDS}, ${episode.byteSize},
        ${AUDIO_CONTENT_TYPE}, 'published', ${SEED_TIME}, ${SEED_TIME}
      )
      on conflict (id) do update set
        show_id = excluded.show_id,
        title = excluded.title,
        script = excluded.script,
        show_notes = excluded.show_notes,
        audio_url = excluded.audio_url,
        duration_seconds = excluded.duration_seconds,
        byte_size = excluded.byte_size,
        audio_content_type = excluded.audio_content_type,
        status = 'published',
        published_at = excluded.published_at
    `;

    // episode_audio has an FK to episodes, so store the bytes after the row.
    await storage.put(episode.id, bytes, AUDIO_CONTENT_TYPE);
    seeded.push(seed);
  }
  return seeded;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  seedExamples()
    .then((seeds) => {
      for (const { definition } of seeds) {
        console.log(`Seeded ${definition.title} (${definition.id})`);
      }
      console.log("Example shows are inactive so the scheduler will not regenerate them.");
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
