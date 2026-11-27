#!/usr/bin/env node
// Dry-run: node --import tsx scripts/stamp-covers.ts
// Apply missing stamps: node --import tsx scripts/stamp-covers.ts --apply

import { sql } from "../lib/db";
import { hasOfficialCoverStamp, stampOfficialCover } from "../lib/cover";
import { uploadedCoverPath } from "../lib/cover-upload";
import { isTrustedArtworkUrl } from "../lib/show-image";

if (process.argv.includes("--help")) {
  console.log("Dry-run official cover stamps: npm run covers:stamp");
  console.log("Apply missing stamps: npm run covers:stamp -- --apply");
  console.log("Set DATABASE_URL and NEON_BASE_URL (defaults to http://localhost:3000).");
  process.exit(0);
}
const apply = process.argv.includes("--apply");
const base = new URL(process.env.NEON_BASE_URL || "http://localhost:3000");
if (!/^https?:$/.test(base.protocol)) throw new Error("NEON_BASE_URL must be an http(s) URL");

type OfficialShow = {
  id: string;
  title: string;
  image_url: string | null;
  content_type: string | null;
  data: Buffer | null;
};

async function sourceImage(show: OfficialShow): Promise<Buffer> {
  if (show.data) return Buffer.from(show.data);
  const url = new URL(show.image_url || `/art/${show.id}`, base);
  if (url.origin !== base.origin && !isTrustedArtworkUrl(url.href)) {
    throw new Error("cover URL is not on this NEON host or its approved artwork host");
  }
  const href = url.href;
  const response = await fetch(href, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`cover request returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const shows = (await sql`
    select s.id, s.title, s.image_url, a.content_type, a.data
    from shows s left join show_artwork a on a.show_id = s.id
    where s.is_official = true order by s.title
  `) as OfficialShow[];
  let missing = 0;
  let failed = 0;
  for (const show of shows) {
    try {
      const image = await sourceImage(show);
      if (await hasOfficialCoverStamp(image)) {
        console.log(`OK    ${show.title} (${show.id})`);
        continue;
      }
      missing += 1;
      console.log(`NEEDS ${show.title} (${show.id})`);
      if (!apply) continue;
      const stamped = await stampOfficialCover(image);
      await sql`
        with saved as (
          insert into show_artwork (show_id, content_type, data, updated_at)
          values (${show.id}, 'image/jpeg', decode(${stamped.toString("base64")}, 'base64'), now())
          on conflict (show_id) do update
            set content_type = 'image/jpeg', data = excluded.data, updated_at = now()
          returning show_id
        )
        update shows set image_url = ${uploadedCoverPath(show.id)}
        where id = ${show.id} and exists (select 1 from saved)
      `;
      console.log(`STAMP ${show.title} (${show.id})`);
    } catch (error) {
      failed += 1;
      console.error(`ERROR ${show.title} (${show.id}): ${error instanceof Error ? error.message : "image processing failed"}`);
    }
  }
  console.log(`${apply ? "Applied" : "Dry run"}: ${shows.length} official shows, ${missing} need a stamp, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Cover stamping failed");
  process.exitCode = 1;
});
