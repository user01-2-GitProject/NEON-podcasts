import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { sql, getSql } from "@/lib/db";
import { accountDeletionBlock, deleteAccount } from "@/lib/account";
import { currentCaller } from "@/lib/current-user";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const caller = await currentCaller({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const blocked = accountDeletionBlock(caller.role, caller.tokenLabel);
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  await deleteAccount(getSql(), caller.userId, caller.email);
  return NextResponse.json({ ok: true });
}
