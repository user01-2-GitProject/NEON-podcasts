type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type MeToken = {
  id: string;
  label: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

// List the caller's own API tokens. Always scoped to created_by = userId so a
// caller can never see another user's tokens.
export async function listMyTokens(db: SqlFn, userId: string): Promise<MeToken[]> {
  return (await db`
    select id, label, scope, created_at, last_used_at, revoked_at
    from api_tokens
    where created_by = ${userId}
    order by created_at desc
  `) as MeToken[];
}

// Revoke one of the caller's own tokens. Scoped to created_by = userId so a
// caller can never revoke another user's token. Revoke = set revoked_at,
// never delete the row. Returns false when nothing matched (not mine / already
// revoked / unknown id).
export async function revokeMyToken(db: SqlFn, userId: string, id: string): Promise<boolean> {
  const rows = (await db`
    update api_tokens set revoked_at = now()
    where id = ${id} and created_by = ${userId} and revoked_at is null
    returning id
  `) as { id: string }[];
  return rows.length > 0;
}

// Revoke every active token the caller owns ("sign out all devices").
// Returns how many were revoked.
export async function revokeAllMyTokens(db: SqlFn, userId: string): Promise<number> {
  const rows = (await db`
    update api_tokens set revoked_at = now()
    where created_by = ${userId} and revoked_at is null
    returning id
  `) as { id: string }[];
  return rows.length;
}

// Deep-link targets the browser sign-in may hand a token to: Expo Go (exp/exps)
// and the NEON app's own scheme. Anything else (http, other apps) is refused so
// a crafted link can't ship a token to a third party.
export function allowedAppRedirect(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return ["exp:", "exps:", "neonpodcasts:"].includes(url.protocol) ? raw : null;
}

export function withToken(redirect: string, token: string): string {
  const url = new URL(redirect);
  url.searchParams.set("token", token);
  return url.toString();
}

// Mint a read_write token for the caller's own device ("Sign in with browser").
export async function createMyDeviceToken(
  db: SqlFn,
  userId: string,
  email: string,
  token: string,
  hash: string,
): Promise<void> {
  await db`
    insert into api_tokens (token_hash, label, scope, created_by)
    values (${hash}, ${"mobile:" + email}, ${"read_write"}, ${userId})
  `;
}
