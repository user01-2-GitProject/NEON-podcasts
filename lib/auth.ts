// Minimal single-user auth gate.
// A signed, httpOnly cookie proves you typed APP_PASSWORD on /login.
// Uses Web Crypto so the same code verifies in Edge middleware and Node routes.

export const SESSION_COOKIE = "np_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64urlEncode(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = b64urlEncode(new TextEncoder().encode(`ok:${issuedAt}`));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const text = new TextDecoder().decode(b64urlToBytes(payload));
    const [, issuedAtStr] = text.split(":");
    const issuedAt = Number(issuedAtStr);
    if (!Number.isFinite(issuedAt)) return false;
    const age = Math.floor(Date.now() / 1000) - issuedAt;
    return age >= 0 && age <= SESSION_TTL_SECONDS;
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(input, expected);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
