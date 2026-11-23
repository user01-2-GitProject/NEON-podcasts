import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, roleForEmail, validOwnerSecret } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") || "").trim().toLowerCase();
  const password = String(form?.get("password") || "");
  const owner = roleForEmail(email) === "owner";
  const url = new URL("/login", req.url);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 1024) {
    url.searchParams.set("error", "invalid");
    return NextResponse.redirect(url, { status: 303 });
  }
  if (owner && !validOwnerSecret(String(form?.get("ownerSecret") || ""))) {
    url.searchParams.set("error", "owner");
    return NextResponse.redirect(url, { status: 303 });
  }
  const rows = (await sql`
    insert into users (email, password_hash, role, owner_approved)
    values (${email}, ${await hashPassword(password)}, ${roleForEmail(email)}, ${owner})
    on conflict (email) do nothing returning id
  `) as { id: string }[];
  url.searchParams.set(rows[0] ? "registered" : "error", rows[0] ? "1" : "exists");
  return NextResponse.redirect(url, { status: 303 });
}
