import Image from "next/image";
import Link from "next/link";
import OfficialBadge from "@/components/OfficialBadge";
import { cadenceLabel } from "@/lib/cadence";
import type { RailEpisode, RailShow } from "@/lib/home-rails";

export type RailCard = {
  id: string;
  href: string;
  title: string;
  meta: string;
  image: string;
  official: boolean;
};

function shortDate(value: string | null): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Recently";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function showCards(shows: RailShow[]): RailCard[] {
  return shows.map((show) => ({
    id: show.id,
    href: `/shows/${show.id}`,
    title: show.title,
    meta: `${cadenceLabel(show.cadence, show.air_days)} · ${show.episode_count} episode${show.episode_count === 1 ? "" : "s"}`,
    image: show.image_url,
    official: show.is_official,
  }));
}

export function episodeCards(episodes: RailEpisode[]): RailCard[] {
  return episodes.map((episode) => ({
    id: episode.id,
    href: `/shows/${episode.show_id}`,
    title: episode.title,
    meta: `${episode.show_title} · ${shortDate(episode.published_at)}`,
    image: episode.image_url,
    official: episode.is_official,
  }));
}

// A horizontal, scroll-snap shelf. Server-rendered: no client JS, so the
// cards and their links work before hydration and on slow devices.
export default function ShowRail({
  id,
  title,
  href,
  cards,
  empty,
}: {
  id: string;
  title: string;
  href?: string;
  cards: RailCard[];
  empty?: string;
}) {
  return (
    <section className="show-rail" aria-labelledby={`${id}-heading`}>
      <div className="rail-heading">
        <h2 id={`${id}-heading`}>{title}</h2>
        {href ? <Link href={href} className="rail-more">See all →</Link> : null}
      </div>
      {cards.length === 0 ? (
        <p className="muted rail-empty">{empty ?? "Nothing here yet."}</p>
      ) : (
        <div className="rail-track" role="list">
          {cards.map((card) => (
            <Link href={card.href} className="rail-card" key={card.id} role="listitem">
              <Image
                className="rail-card-art"
                src={card.image}
                alt=""
                width={320}
                height={320}
                unoptimized
              />
              <h3 className="rail-card-title">
                {card.official ? <OfficialBadge size={20} /> : null}
                <span>{card.title}</span>
              </h3>
              <p className="muted rail-card-meta">{card.meta}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
