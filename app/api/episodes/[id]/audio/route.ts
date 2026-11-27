import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { sanitizeError } from "@/lib/errors";
import { generateEpisodeAudio } from "@/lib/generate-episode-audio";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Streams the stored mp3. ?download=1 forces a file download.
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const feedToken = new URL(req.url).searchParams.get("feed");
  const rows = (await sql`
    select e.title
    from episodes e
    join shows s on s.id = e.show_id
    where e.id = ${id}
      and (${feedToken}::text is null or (e.status = 'published' and s.rss_token = ${feedToken}))
  `) as { title: string }[];

  const row = rows[0];
  if (!row) return new Response("Not found", { status: 404 });

  const stored = await getStorage().get(id);
  if (!stored) return new Response("Not found", { status: 404 });
  const audio = stored.bytes;
  const download = new URL(req.url).searchParams.get("download");
  const safeTitle = row.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "episode";

  const headers: Record<string, string> = {
    "Content-Type": stored.contentType || "audio/mpeg",
    "Content-Length": String(audio.length),
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${safeTitle}.mp3"`;
  }

  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match || audio.length === 0) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${audio.length}` },
      });
    }

    const requestedStart = BigInt(match[1]);
    const requestedEnd = match[2] ? BigInt(match[2]) : BigInt(audio.length - 1);
    const lastByte = BigInt(audio.length - 1);
    if (requestedStart >= BigInt(audio.length) || requestedStart > requestedEnd) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${audio.length}` },
      });
    }

    const start = Math.max(0, Number(requestedStart));
    const end = Number(requestedEnd > lastByte ? lastByte : requestedEnd);
    const partialHeaders = {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${audio.length}`,
    };
    return new Response(new Uint8Array(audio.subarray(start, end + 1)), {
      status: 206,
      headers: partialHeaders,
    });
  }

  return new Response(new Uint8Array(audio), { status: 200, headers });
}

// Upload a finished mp3 into this episode (Pattern A: narrate externally, e.g.
// in Muse, then upload the result here). Accepts a multipart form with a "file"
// field, or a raw audio body. Stores the bytes and leaves the episode as a draft.
export const maxDuration = 300;

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;

  // JSON starts TTS for a generated draft; multipart and raw bodies remain uploads.
  if (req.headers.get("content-type")?.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const runId = typeof body?.runId === "string" ? body.runId : "";
    if (!runId) return NextResponse.json({ error: "A run id is required to make audio." }, { status: 400 });
    const state = (await sql`
      select r.status as run_status, e.status as episode_status
      from runs r join episodes e on e.id = r.episode_id
      where r.id = ${runId} and e.id = ${id}
    `) as { run_status: string; episode_status: string }[];
    if (!state[0]) return NextResponse.json({ error: "That draft could not be found." }, { status: 409 });
    if (state[0].run_status === "done" && state[0].episode_status === "published") {
      return NextResponse.json({ runId, complete: true });
    }
    const claimed = (await sql`
      update runs set status = 'running', error = null, heartbeat_at = now(), finished_at = null
      where id = ${runId} and episode_id = ${id} and status in ('done', 'failed')
      returning id
    `) as { id: string }[];
    if (!claimed[0] && state[0].run_status !== "running") {
      const active = (await sql`
        select id from runs where id = ${runId} and episode_id = ${id} and status = 'running'
      `) as { id: string }[];
      if (!active[0]) return NextResponse.json({ error: "That draft could not be found." }, { status: 409 });
    }
    try {
      const result = await generateEpisodeAudio(id, runId);
      return NextResponse.json({ runId, complete: result.complete }, { status: result.complete ? 200 : 202 });
    } catch (err) {
      return NextResponse.json({ runId, error: sanitizeError(err, "episode audio generation") }, { status: 500 });
    }
  }

  const episodeRows = (await sql`select id from episodes where id = ${id}`) as { id: string }[];
  if (!episodeRows[0]) return NextResponse.json({ error: "We couldn't find that episode." }, { status: 404 });

  let bytes: Buffer;
  let contentType = "audio/mpeg";

  const reqType = req.headers.get("content-type") || "";
  try {
    if (reqType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Pick an audio file to upload." }, { status: 400 });
      }
      if (file.type) contentType = file.type;
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      // Raw body upload (e.g. a direct PUT/POST of the mp3).
      if (reqType) contentType = reqType;
      bytes = Buffer.from(await req.arrayBuffer());
    }
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeError(err, "audio upload read") },
      { status: 400 }
    );
  }

  if (bytes.length === 0) {
    return NextResponse.json({ error: "That file is empty. Pick another one." }, { status: 400 });
  }

  const storage = getStorage();
  await storage.put(id, bytes, contentType);
  const audioPath = storage.url(id);
  const rows = (await sql`
    update episodes
      set audio_url = ${audioPath},
          byte_size = ${bytes.length},
          audio_content_type = ${contentType},
          status = 'draft'
    where id = ${id}
    returning *
  `) as unknown[];

  return NextResponse.json({ episode: rows[0] }, { status: 200 });
}
