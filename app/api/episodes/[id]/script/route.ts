import { sql } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Downloads the episode script as Markdown — the file you feed to an external
// narrator (e.g. Muse) to render the audio. ?inline=1 shows it in the browser.
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const rows = (await sql`
    select title, script, show_notes from episodes where id = ${id}
  `) as { title: string; script: string; show_notes: string }[];

  const row = rows[0];
  if (!row) return new Response("Not found", { status: 404 });

  const md = [
    `# ${row.title}`,
    "",
    row.script || "",
    row.show_notes ? `\n---\n\n## Show notes\n\n${row.show_notes}` : "",
    "",
  ].join("\n");

  const safeTitle =
    row.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "episode";
  const inline = new URL(req.url).searchParams.get("inline");

  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "private, max-age=60",
  };
  if (!inline) {
    headers["Content-Disposition"] = `attachment; filename="${safeTitle}.md"`;
  }

  return new Response(md, { status: 200, headers });
}
