import { sql } from "@/lib/db";
import type { Show } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };
type FeedEpisode = {
  id: string;
  title: string;
  show_notes: string;
  audio_url: string;
  byte_size: number;
  content_type: string;
  duration_seconds: number | null;
  published_at: string;
};

const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const shows = (await sql`select * from shows where rss_token = ${token} limit 1`) as Show[];
  const show = shows[0];
  if (!show) return new Response("Not found", { status: 404 });

  const episodes = (await sql`
    select e.id, e.title, e.show_notes, e.audio_url, e.byte_size,
           ea.content_type, e.duration_seconds, e.published_at
    from episodes e
    join episode_audio ea on ea.episode_id = e.id
    where e.show_id = ${show.id} and e.status = 'published'
      and e.audio_url is not null and e.byte_size > 0 and e.published_at is not null
    order by e.published_at desc, e.created_at desc
  `) as FeedEpisode[];

  const origin = new URL(req.url).origin;
  const feedUrl = new URL(`/feed/${token}`, origin).href;
  const items = episodes.map((episode) => {
    const audio = new URL(episode.audio_url, origin);
    if (audio.origin === origin && /^\/api\/episodes\/[^/]+\/audio$/.test(audio.pathname)) {
      audio.searchParams.set("feed", token);
    }
    return `<item>
      <title>${xml(episode.title)}</title>
      <description>${xml(episode.show_notes)}</description>
      <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
      <guid isPermaLink="false">${xml(episode.id)}</guid>
      <enclosure url="${xml(audio.href)}" length="${episode.byte_size}" type="${xml(episode.content_type || "audio/mpeg")}" />
      ${episode.duration_seconds == null ? "" : `<itunes:duration>${episode.duration_seconds}</itunes:duration>`}
    </item>`;
  }).join("\n");

  const description = show.description || show.title;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(show.title)}</title>
    <link>${xml(feedUrl)}</link>
    <description>${xml(description)}</description>
    <language>en-us</language>
    <itunes:author>${xml(show.title)}</itunes:author>
    <itunes:image href="${xml(new URL("/podcast-cover.png", origin).href)}" />
    <itunes:category text="Technology" />
    <itunes:explicit>false</itunes:explicit>
    <itunes:summary>${xml(description)}</itunes:summary>
    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
