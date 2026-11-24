// Show artwork is an http(s) image URL (file upload comes later). Empty or
// null clears it. Anything else is rejected with a client-safe message.
export const IMAGE_URL_MAX = 2048;

export function parseImageUrl(input: unknown): { value: string | null } | { error: string } {
  if (input === null) return { value: null };
  if (typeof input !== "string") return { error: "image_url must be a string" };
  const value = input.trim();
  if (!value) return { value: null };
  if (value.length > IMAGE_URL_MAX) return { error: `image_url is limited to ${IMAGE_URL_MAX} characters` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "image_url must be an http(s) URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "image_url must be an http(s) URL" };
  return { value: url.href };
}
