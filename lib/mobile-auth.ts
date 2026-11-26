import { newApiToken, tokenHash } from "@/lib/api-tokens";
import { roleForEmail } from "@/lib/auth";

export type GoogleTokenInfo = {
  email?: unknown;
  email_verified?: unknown;
  aud?: unknown;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

// The Google OAuth client IDs we accept a mobile ID token's `aud` to equal.
// A native Expo app signs in with its own iOS/Android (or Expo proxy) client
// ID, which differs from the web GOOGLE_CLIENT_ID used by Auth.js — so we
// allow the web id plus any ids in GOOGLE_MOBILE_CLIENT_IDS (comma-separated).
export function allowedGoogleAudiences(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const raw = [env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_MOBILE_CLIENT_IDS || "").split(",")];
  return Array.from(
    new Set(raw.map((value) => (value || "").trim()).filter((value) => value.length > 0)),
  );
}

// Verify a Google ID token against Google's tokeninfo endpoint.
// Returns parsed claims, or null on any non-OK response.
export async function fetchGoogleTokenInfo(
  idToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleTokenInfo | null> {
  const res = await fetchFn(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as GoogleTokenInfo;
}

export type ExchangeResult = { status: number; body: Record<string, unknown> };

// Pure, injectable core of the mobile token-exchange flow.
export async function exchangeGoogleIdToken(opts: {
  idToken: unknown;
  allowedAudiences: string[];
  db: SqlFn;
  verify: (idToken: string) => Promise<GoogleTokenInfo | null>;
  genToken?: () => string;
}): Promise<ExchangeResult> {
  const { idToken, allowedAudiences, db, verify } = opts;
  const genToken = opts.genToken ?? newApiToken;

  if (typeof idToken !== "string" || idToken.length === 0) {
    return { status: 400, body: { error: "The sign-in didn't come through. Try again." } };
  }
  if (allowedAudiences.length === 0) {
    return { status: 500, body: { error: "Google sign-in isn't set up for the app yet." } };
  }

  const info = await verify(idToken);
  if (!info) return { status: 401, body: { error: "Google couldn't confirm that sign-in. Try again." } };

  // tokeninfo returns aud and email_verified as strings; accept string or boolean.
  if (typeof info.aud !== "string" || !allowedAudiences.includes(info.aud)) {
    return { status: 401, body: { error: "That sign-in came from an app we don't know." } };
  }
  const verified = info.email_verified === true || info.email_verified === "true";
  const email =
    typeof info.email === "string" ? info.email.trim().toLowerCase() : null;
  if (!verified || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 401, body: { error: "Your Google email isn't verified yet. Verify it with Google, then try again." } };
  }

  const role = roleForEmail(email);
  // Upsert the user; DO UPDATE (no-op on email) so RETURNING yields the row on conflict.
  // Existing users keep their stored role (never clobbered by sign-in).
  const users = (await db`
    insert into users (email, role)
    values (${email}, ${role})
    on conflict (email) do update set email = excluded.email
    returning id, role
  `) as { id: string; role: string }[];
  const userId = users[0].id;
  const storedRole = users[0].role;

  const token = genToken();
  await db`
    insert into api_tokens (token_hash, label, scope, created_by)
    values (${await tokenHash(token)}, ${"mobile:" + email}, ${"read_write"}, ${userId})
  `;

  return { status: 200, body: { token, email, role: storedRole } };
}
