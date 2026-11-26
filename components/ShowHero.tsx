import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cadenceLabel } from "@/lib/cadence";
import { artworkPath } from "@/lib/cover";
import type { Show } from "@/lib/types";
import DeleteShowButton from "@/components/DeleteShowButton";
import OfficialBadge from "@/components/OfficialBadge";
import OfficialToggle from "@/components/OfficialToggle";
import ShowArtworkForm from "@/components/ShowArtworkForm";

// "18:00" → "6:00 PM"
export function friendlyTime(hhmm: string): string {
  const [h, m = "00"] = hhmm.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return hhmm;
  return `${hour % 12 || 12}:${m.slice(0, 2)} ${hour < 12 ? "AM" : "PM"}`;
}

// Product-page header for a show: large display title, gold hairline, and an
// art + actions column that stays reachable while the episode list scrolls.
export default function ShowHero({
  show,
  owner,
  justSaved,
  children,
}: {
  show: Show;
  owner: boolean;
  justSaved: boolean;
  children?: ReactNode;
}) {
  const meta = [
    cadenceLabel(show.cadence, show.air_days),
    show.cadence !== "manual" && show.schedule_time ? `at ${friendlyTime(show.schedule_time)}` : null,
    `~${show.target_minutes} min`,
    `timezone ${show.timezone}`,
  ].filter(Boolean);

  return (
    <section className="show-detail" aria-labelledby="show-detail-title">
      <div className="show-detail-aside">
        <Image
          className="show-detail-art"
          src={artworkPath(show)}
          alt={`${show.title} artwork`}
          width={640}
          height={640}
          unoptimized
          priority
        />
        {owner ? (
          <div className="show-detail-actions">
            <Link href={`/shows/${show.id}/edit`} className="btn primary">✏️ Edit show</Link>
            <Link href={`/shows/${show.id}/edit#schedule`} className="btn secondary">🗓️ Edit schedule</Link>
            <OfficialToggle showId={show.id} initialOfficial={!!show.is_official} />
            <ShowArtworkForm showId={show.id} initialImageUrl={show.image_url ?? null} />
            <DeleteShowButton showId={show.id} showTitle={show.title} />
          </div>
        ) : null}
      </div>

      <div className="show-detail-main">
        <p className="eyebrow">NEON Podcast</p>
        <h2 id="show-detail-title" className="show-detail-title">
          {show.is_official ? <OfficialBadge size={32} /> : null}
          {show.title}
        </h2>
        <p className="show-detail-description">{show.description || "No description."}</p>
        <p className="muted show-detail-meta">{meta.join(" · ")}</p>
        {owner && justSaved ? (
          <div className="notice-safe" role="status">
            <strong>Saved.</strong> Your episodes are all still here. New episodes will use your changes.
          </div>
        ) : null}
        {owner ? (
          <p className="muted">Editing is safe. You won&apos;t start over, and your episodes stay put.</p>
        ) : null}
        <a className="btn secondary show-detail-listen" href={`/listen/${show.rss_token}`}>Listen to this show →</a>
        {children}
      </div>
    </section>
  );
}
