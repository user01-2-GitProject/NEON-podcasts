export type ApiTokenScope = "read_only" | "read_write";

export function newApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `npt_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer (npt_[0-9a-f]{64})$/i.exec(header || "");
  return match?.[1] ?? null;
}

export async function tokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function scopeAllows(scope: ApiTokenScope, method: string): boolean {
  return scope === "read_write" || ["GET", "HEAD", "OPTIONS"].includes(method);
}

// Paths any signed-in user (member or owner) may mutate without being an owner:
// the community subscriptions and a user's own device/token management.
export function isSelfServicePath(pathname: string): boolean {
  return (
    pathname === "/api/subscriptions" ||
    pathname.startsWith("/api/subscriptions/") ||
    pathname === "/api/me/tokens" ||
    pathname.startsWith("/api/me/tokens/")
  );
}

// Whether a bearer-token request is allowed, mirroring the cookie-session policy:
// reads need only read-capable scope; mutations need read_write AND are owner-only,
// except the self-service carve-out (so a member's mobile token can follow/unfollow
// and manage its own tokens but cannot drive owner-only APIs).
export function bearerRequestAllowed(opts: {
  scope: ApiTokenScope;
  role: string;
  ownerApproved: boolean;
  method: string;
  pathname: string;
}): boolean {
  if (!scopeAllows(opts.scope, opts.method)) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(opts.method)) return true;
  if (isSelfServicePath(opts.pathname)) return true;
  return opts.role === "owner" && opts.ownerApproved === true;
}
