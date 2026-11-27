import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { sanitizeError } from "@/lib/errors";
import { checkGeneration } from "@/lib/limits";
import {
  MAX_PREVIEW_CHARS,
  PREVIEWS_PER_DAY,
  cleanPreviewScript,
  previewCounterKey,
  previewScript,
} from "@/lib/preview";
import { synthesize } from "@/lib/tts";
import { EMPTY_WIZARD, brandedTitle, type WizardDraft } from "@/lib/wizard-steps";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/preview
//   { draft: WizardDraft, host_name?: string, voice?: string, script?: string }
// -> { script, audio_base64, content_type }
//
// The wizard's "Hear your show" step. Builds a canned, format-specific first
// paragraph and reads it in the picked voice. Sending back the cached `script`
// only re-voices it. Nothing is saved.
export async function POST(req: Request) {
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "Please sign in to hear a preview." }, { status: 401 });
  const isOwner = caller.role === "owner" && caller.ownerApproved;

  let body: { draft?: unknown; host_name?: unknown; voice?: unknown; script?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "That request didn't come through right. Try again." }, { status: 400 });
  }

  const voice = typeof body.voice === "string" ? body.voice.trim().slice(0, 100) : "";
  const hostName = typeof body.host_name === "string" && body.host_name.trim() ? body.host_name.trim().slice(0, 60) : "your host";
  const given = typeof body.script === "string" ? cleanPreviewScript(body.script) : "";

  // Guardrails for non-owners: none once the day's episode budget is gone,
  // and PREVIEWS_PER_DAY fresh previews a day.
  if (!isOwner) {
    const decision = await checkGeneration(sql, { userId: caller.userId, isOwner: false });
    if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 429 });
    const key = previewCounterKey(caller.userId, new Date());
    const rows = (await sql`
      insert into app_settings (key, value, updated_at) values (${key}, '1', now())
      on conflict (key) do update set value = ((coalesce(nullif(app_settings.value, ''), '0'))::int + 1)::text, updated_at = now()
      returning value
    `) as { value: string }[];
    // Old day counters are cleared as we go so the table stays small.
    await sql`delete from app_settings where key like 'preview_uses:%' and updated_at < now() - interval '2 days'`;
    if (Number(rows[0]?.value ?? 0) > PREVIEWS_PER_DAY) {
      return NextResponse.json(
        { error: `You've heard today's ${PREVIEWS_PER_DAY} previews. You can still create the show, or try again tomorrow.` },
        { status: 429 },
      );
    }
  }

  let script = given;
  if (!script) {
    const raw = (body.draft && typeof body.draft === "object" ? body.draft : {}) as Partial<WizardDraft>;
    const draft: WizardDraft = {
      ...EMPTY_WIZARD,
      title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "",
      host_count: raw.host_count === 2 ? 2 : 1,
      format: typeof raw.format === "string" ? raw.format.slice(0, 40) : "",
      answers: raw.answers && typeof raw.answers === "object" && !Array.isArray(raw.answers)
        ? Object.fromEntries(
            Object.entries(raw.answers as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k.slice(0, 60), (v as string).slice(0, 5000)]),
          )
        : {},
    };
    script = previewScript({
      showTitle: brandedTitle(draft.title || "Your new show"),
      hostName,
      format: draft.format,
      about: draft.answers.about || "",
    });
  }
  if (!script) return NextResponse.json({ error: "The writer came back empty. Try again." }, { status: 502 });

  try {
    const tts = await synthesize(script.slice(0, MAX_PREVIEW_CHARS), voice || null);
    return NextResponse.json({
      script,
      audio_base64: tts.audio.toString("base64"),
      content_type: tts.contentType,
    });
  } catch (err) {
    sanitizeError(err, "preview voice");
    const raw = err instanceof Error ? err.message : String(err);
    const error = /^No OpenAI voice key/.test(raw)
      ? "There's no voice key yet. An owner can add one under Settings → Voice, or pick a free voice."
      : "That voice didn't work just now. Try another voice, or try again in a minute.";
    // The script is sent back so trying another voice doesn't pay for it again.
    return NextResponse.json({ error, script }, { status: 502 });
  }
}
