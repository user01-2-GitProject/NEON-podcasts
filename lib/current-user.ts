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
