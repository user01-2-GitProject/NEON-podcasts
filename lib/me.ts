import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { currentUserEmail } from "@/lib/current-user";

// Resolve the acting user's id from either the cookie session or a bearer
// token, then map that email to users.id. Returns null when unauthenticated
// or the email has no users row.
export async function currentUserId(req: Request): Promise<string | null> {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return null;
  const rows = (await sql`select id from users where email = ${email} limit 1`) as { id: string }[];
  return rows[0]?.id ?? null;
}
