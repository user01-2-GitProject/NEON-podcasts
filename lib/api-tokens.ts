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
