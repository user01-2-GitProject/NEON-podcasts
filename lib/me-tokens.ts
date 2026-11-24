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
