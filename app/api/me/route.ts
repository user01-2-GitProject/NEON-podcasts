import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { sql, getSql } from "@/lib/db";
import { accountDeletionError, deleteAccount } from "@/lib/account";
import { currentUserEmail } from "@/lib/current-user";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = (await sql`
    select id, role from users where email = ${email} limit 1
  `) as { id: string; role: string }[];
  const user = rows[0];
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const error = accountDeletionError(user.role);
  if (error) return NextResponse.json({ error }, { status: 409 });

  await deleteAccount(getSql(), user.id, email);
  return NextResponse.json({ ok: true });
}