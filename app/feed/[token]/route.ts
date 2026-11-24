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
type FeedSetting = { key: string; value: string | null };

const VALID_CATEGORIES = new Set([
  "Arts", "Business", "Comedy", "Education", "Fiction", "Government", "History", "Health & Fitness",
  "Kids & Family", "Leisure", "Music", "News", "Religion & Spirituality", "Science", "Society & Culture",
  "Sports", "Technology", "True Crime", "TV & Film",
]);

const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function duration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const shows = (await sql`select * from shows where rss_token = ${token} limit 1`) as Show[];
  const show = shows[0];
  if (!show) return new Response("Not found", { status: 404 });

  const episodes = (await sql`
    select e.id, e.title, e.show_notes, e.audio_url, e.byte_size,
           e.audio_content_type as content_type, e.duration_seconds, e.published_at
    from episodes e
    where e.show_id = ${show.id} and e.status = 'published'
      and e.audio_url is not null and e.byte_size > 0 and e.published_at is not null
    order by e.published_at desc, e.created_at desc
  `) as FeedEpisode[];

  const settingRows = (await sql`
    select key, value from app_settings
    where key in ('rss_owner_name', 'rss_owner_email', 'rss_author', 'rss_category', 'rss_explicit')
  `) as FeedSetting[];
  const settings = Object.fromEntries(settingRows.map(({ key, value }) => [key, value || ""]));
  const ownerEmail = settings.rss_owner_email || process.env.OWNER_EMAILS?.split(",")[0]?.trim() || "";
  const ownerName = settings.rss_owner_name || show.title;
  const author = settings.rss_author || show.title;
  const category = VALID_CATEGORIES.has(settings.rss_category) ? settings.rss_category : "Technology";
  const explicit = settings.rss_explicit === "true" ? "true" : "false";

  const origin = new URL(req.url).origin;
  const feedUrl = new URL(`/feed/${token}`, origin).href;
  const items = episodes.map((episode) => {
    const audio = new URL(episode.audio_url, origin);
    const episodeDuration = duration(episode.duration_seconds);
    if (audio.origin === origin && /^\/api\/episodes\/[^/]+\/audio$/.test(audio.pathname)) {
      audio.searchParams.set("feed", token);
    }
    return `<item>
      <title>${xml(episode.title)}</title>
      <description>${xml(episode.show_notes)}</description>
      <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
      <guid isPermaLink="false">${xml(episode.id)}</guid>
      <enclosure url="${xml(audio.href)}" length="${episode.byte_size}" type="audio/mpeg" />
      <itunes:explicit>${explicit}</itunes:explicit>
      ${episodeDuration == null ? "" : `<itunes:duration>${episodeDuration}</itunes:duration>`}
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
    <itunes:author>${xml(author)}</itunes:author>
    <itunes:image href="${xml(new URL("/podcast-cover.png", origin).href)}" />
    <itunes:category text="${xml(category)}" />
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <itunes:owner>
      <itunes:name>${xml(ownerName)}</itunes:name>
      <itunes:email>${xml(ownerEmail)}</itunes:email>
    </itunes:owner>
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
