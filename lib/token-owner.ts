import { auth } from "@/auth";
import { roleForEmail } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function ownerId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || (session.user as { role?: string }).role !== "owner" || roleForEmail(email) !== "owner") {
    return null;
  }
  const rows = (await sql`
    select id from users where email = ${email} and role = 'owner' and owner_approved = true
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}
