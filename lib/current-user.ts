import { bearerToken, tokenHash } from "@/lib/api-tokens";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type SessionLike = { user?: { email?: string | null } | null } | null;

// Resolve the acting user's email from the Auth.js session if present,
// otherwise from a bearer token (api_tokens.token_hash -> users.email).
// Cookie-session behavior is identical to the old subscriberEmail().
export async function currentUserEmail(opts: {
  session: SessionLike;
  authHeader: string | null;
  db: SqlFn;
}): Promise<string | null> {
  const sessionEmail = opts.session?.user?.email;
  if (typeof sessionEmail === "string" && sessionEmail.length > 0) {
    return sessionEmail.toLowerCase();
  }
  const raw = bearerToken(opts.authHeader);
  if (!raw) return null;
  const rows = (await opts.db`
    select u.email as email
    from api_tokens t
    join users u on u.id = t.created_by
    where t.token_hash = ${await tokenHash(raw)} and t.revoked_at is null
    limit 1
  `) as { email: string | null }[];
  const email = rows[0]?.email;
  return typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;
}

export type Caller = {
  userId: string;
  email: string;
  role: string;
  ownerApproved: boolean;
  // The calling API token; both null for a browser cookie session.
  tokenId: string | null;
  tokenLabel: string | null;
};

type CallerRow = {
  user_id: string;
  email: string | null;
  role: string;
  owner_approved: boolean;
  token_id: string | null;
  token_label: string | null;
};

// Like currentUserEmail(), but also returns the user id/role and, for a bearer
// caller, the token's id and label (live sessions derive agent vs human from
// the label). Revoked tokens resolve to null.
export async function currentCaller(opts: { session: SessionLike; authHeader: string | null; db: SqlFn }): Promise<Caller | null> {
  const sessionEmail = opts.session?.user?.email;
  let rows: CallerRow[];
  if (typeof sessionEmail === "string" && sessionEmail.length > 0) {
    rows = (await opts.db`
      select id as user_id, email, role, owner_approved, null as token_id, null as token_label
      from users where email = ${sessionEmail.toLowerCase()} limit 1
    `) as CallerRow[];
  } else {
    const raw = bearerToken(opts.authHeader);
    if (!raw) return null;
    rows = (await opts.db`
      select u.id as user_id, u.email, u.role, u.owner_approved, t.id as token_id, t.label as token_label
      from api_tokens t
      join users u on u.id = t.created_by
      where t.token_hash = ${await tokenHash(raw)} and t.revoked_at is null
      limit 1
    `) as CallerRow[];
  }
  const row = rows[0];
  if (!row || typeof row.email !== "string" || row.email.length === 0) return null;
  return {
    userId: row.user_id,
    email: row.email.toLowerCase(),
    role: row.role,
    ownerApproved: row.owner_approved === true,
    tokenId: row.token_id,
    tokenLabel: row.token_label,
  };
}
