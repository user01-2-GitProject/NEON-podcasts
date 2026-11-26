import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type PushTokenInput = { expoPushToken: string; deviceId: string };

const EXPO_TOKEN = /^ExpoPushToken\[[A-Za-z0-9._-]+\]$/;
const DEVICE_ID = /^[A-Za-z0-9._:-]+$/;
const MAX_BODY_BYTES = 4096;

// Validate the mobile payload before it ever reaches SQL. Both fields are
// bounded and strictly shaped; nothing here is interpolated into SQL directly.
export function parsePushTokenInput(body: unknown): PushTokenInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as { expo_push_token?: unknown; device_id?: unknown };
  if (typeof input.expo_push_token !== "string" || typeof input.device_id !== "string") return null;
  const expoPushToken = input.expo_push_token.trim();
  const deviceId = input.device_id.trim();
  if (expoPushToken.length > 512 || !EXPO_TOKEN.test(expoPushToken)) return null;
  if (deviceId.length < 1 || deviceId.length > 128 || !DEVICE_ID.test(deviceId)) return null;
  return { expoPushToken, deviceId };
}

// Idempotent by token: re-registering from the same device leaves one active
// row. A rotated token retires the previous token for that device (so old rows
// are never treated as live) while the unique token constraint lets a token
// issued again after a reinstall be reactivated.
export async function storePushToken(db: SqlFn, userId: string, input: PushTokenInput): Promise<void> {
  await db`
    with retired as (
      update push_tokens
         set revoked_at = now(), updated_at = now()
       where user_id = ${userId}
         and device_id = ${input.deviceId}
         and expo_push_token <> ${input.expoPushToken}
         and revoked_at is null
    )
    insert into push_tokens (user_id, device_id, expo_push_token)
    values (${userId}, ${input.deviceId}, ${input.expoPushToken})
    on conflict (expo_push_token) do update set
      user_id = excluded.user_id,
      device_id = excluded.device_id,
      revoked_at = null,
      updated_at = now()
  `;
}

// Accepts the app's bearer token or a browser cookie via currentUserId(), like
// the other /api/me routes. Registration only stores a token — no pushes sent.
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid push token payload" }, { status: 400 });
  }
  const input = parsePushTokenInput(body);
  if (!input) return NextResponse.json({ error: "invalid push token payload" }, { status: 400 });

  await storePushToken(sql, userId, input);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
