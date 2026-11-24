type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export function subscriberEmail(session: { user?: { email?: string | null } | null } | null): string | null {
  const email = session?.user?.email;
  return typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;
}

export async function listFollows(db: SqlFn, email: string): Promise<string[]> {
  const rows = (await db`select show_id from subscriptions where subscriber_email = ${email}`) as { show_id: string }[];
  return rows.map((row) => row.show_id);
}

export async function showExists(db: SqlFn, showId: string): Promise<boolean> {
  const rows = (await db`select id from shows where id = ${showId} limit 1`) as { id: string }[];
  return rows.length > 0;
}

export async function follow(db: SqlFn, email: string, showId: string): Promise<void> {
  // idempotent: unique(subscriber_email, show_id) + do nothing
  await db`
    insert into subscriptions (subscriber_email, show_id)
    values (${email}, ${showId})
    on conflict (subscriber_email, show_id) do nothing
  `;
}

export async function unfollow(db: SqlFn, email: string, showId: string): Promise<void> {
  // scoped to the caller's email so one user can never remove another's follow
  await db`delete from subscriptions where subscriber_email = ${email} and show_id = ${showId}`;
}
