import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { sanitizeError } from "@/lib/errors";

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

  return new Response(new Uint8Array(audio), { status: 200, headers });
}

// Upload a finished mp3 into this episode (Pattern A: narrate externally, e.g.
// in Muse, then upload the result here). Accepts a multipart form with a "file"
// field, or a raw audio body. Stores the bytes and publishes the episode.
export const maxDuration = 120;

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;

  const episodeRows = (await sql`select id from episodes where id = ${id}`) as { id: string }[];
  if (!episodeRows[0]) return NextResponse.json({ error: "Episode not found" }, { status: 404 });

  let bytes: Buffer;
  let contentType = "audio/mpeg";

  const reqType = req.headers.get("content-type") || "";
  try {
    if (reqType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
    return NextResponse.json({ error: "Empty upload" }, { status: 400 });
  }

  const storage = getStorage();
  await storage.put(id, bytes, contentType);
  const audioPath = storage.url(id);
  const rows = (await sql`
    update episodes
      set audio_url = ${audioPath},
          byte_size = ${bytes.length},
          audio_content_type = ${contentType},
          status = 'published',
          published_at = coalesce(published_at, now())
    where id = ${id}
    returning *
  `) as unknown[];

  return NextResponse.json({ episode: rows[0] }, { status: 200 });
}
