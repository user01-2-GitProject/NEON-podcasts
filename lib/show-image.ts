// Show artwork. Every show gets a free cover made from its name; people can't
// paste their own picture links, because a feed with NEON's name on it goes to
// Apple and Spotify and anyone could point it at anything. The only links kept
// are NEON's own sites. Empty or null clears it. Owners can upload a picture
// instead (lib/cover-upload.ts, /api/shows/[id]/artwork).
export const IMAGE_URL_MAX = 2048;

// NEON's own sites. Keep in step with TRUSTED_ART_HOSTS in lib/show-spec.ts.
export const TRUSTED_ART_HOSTS = ["needlesslyengineeredonlinenetwork.com"];

export const ARTWORK_LINKS_OFF =
  "Picture links are turned off. Every show gets a free cover made from its name, and made-for-you artwork is coming.";

export function isTrustedArtworkUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return TRUSTED_ART_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function parseImageUrl(input: unknown): { value: string | null } | { error: string } {
  if (input === null) return { value: null };
  if (typeof input !== "string") return { error: "The picture link needs to be a web address." };
  const value = input.trim();
  if (!value) return { value: null };
  if (value.length > IMAGE_URL_MAX) return { error: `That picture link is too long (over ${IMAGE_URL_MAX} characters).` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "The picture link needs to start with https://." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "The picture link needs to start with https://." };
  if (!isTrustedArtworkUrl(url.href)) return { error: ARTWORK_LINKS_OFF };
  return { value: url.href };
}
