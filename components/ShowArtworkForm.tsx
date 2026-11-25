// What the owner sees about their show's cover. Picture links and uploads are
// turned off (anything could end up on Apple and Spotify under NEON's name),
// so this only explains where the cover comes from.
import { isTrustedArtworkUrl } from "@/lib/show-image";

export default function ShowArtworkForm({ initialImageUrl }: { showId?: string; initialImageUrl: string | null }) {
  return (
    <p className="muted" style={{ marginTop: 12 }}>
      {isTrustedArtworkUrl(initialImageUrl)
        ? "This show uses artwork from the NEON site."
        : "Your cover is made for you from the show's name."}{" "}
      Made-for-you artwork, drawn from everything you told us about the show, is coming soon.
    </p>
  );
}
