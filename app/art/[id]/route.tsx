import { ImageResponse } from "next/og";
import { sql } from "@/lib/db";
import { coverFontSize, coverPalette } from "@/lib/cover";

export const runtime = "nodejs";

const SIZE = 1400; // Apple Podcasts wants a square between 1400 and 3000 px.

type Params = { params: Promise<{ id: string }> };

// A show's cover (public, like the feed that points at it): the picture an
// owner uploaded, or else one drawn from the show's name.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const rows = (await sql`select id, title from shows where id = ${id}`) as { id: string; title: string }[];
  const show = rows[0];
  if (!show) return new Response("Not found", { status: 404 });

  // A cover an owner uploaded wins. Before migration 010 the table is missing,
  // so fall through to the generated cover.
  const uploaded = (await sql`
    select content_type, data from show_artwork where show_id = ${id}
  `.catch(() => [])) as { content_type: string; data: Buffer }[];
  if (uploaded[0]) {
    const bytes = Buffer.from(uploaded[0].data);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": uploaded[0].content_type,
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const p = coverPalette(show.id);
  const title = show.title.trim() || "Untitled show";
  const fontSize = coverFontSize(title);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 110,
          background: `linear-gradient(${p.angle}deg, ${p.from}, ${p.to})`,
          color: "#ffffff",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -260,
            top: -260,
            width: 900,
            height: 900,
            borderRadius: 900,
            border: `40px solid ${p.glow}`,
            opacity: 0.35,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -180,
            bottom: -320,
            width: 700,
            height: 700,
            borderRadius: 700,
            background: p.glow,
            opacity: 0.18,
            display: "flex",
          }}
        />
        <div style={{ display: "flex", fontSize: 56, letterSpacing: 18, color: p.glow }}>NEON</div>
        <div
          style={{
            display: "flex",
            fontSize,
            lineHeight: 1.05,
            fontWeight: 700,
            textShadow: `0 0 40px ${p.glow}`,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", height: 16, width: 360, background: p.glow, borderRadius: 8 }} />
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    },
  );
}
