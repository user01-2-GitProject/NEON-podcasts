import { sql } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Streams the stored mp3. ?download=1 forces a file download.
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const rows = (await sql`
    select ea.content_type, encode(ea.data, 'base64') as data_b64, e.title
    from episode_audio ea
    join episodes e on e.id = ea.episode_id
    where ea.episode_id = ${id}
  `) as { content_type: string; data_b64: string; title: string }[];

  const row = rows[0];
  if (!row) return new Response("Not found", { status: 404 });

  const audio = Buffer.from(row.data_b64, "base64");
  const download = new URL(req.url).searchParams.get("download");
  const safeTitle = row.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "episode";

  const headers: Record<string, string> = {
    "Content-Type": row.content_type || "audio/mpeg",
    "Content-Length": String(audio.length),
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${safeTitle}.mp3"`;
  }

  return new Response(new Uint8Array(audio), { status: 200, headers });
}
