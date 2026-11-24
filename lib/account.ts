type TransactionalSql = {
  transaction: (callback: (tx: any) => any[]) => Promise<unknown[]>;
};

export function accountDeletionError(role: string): string | null {
  return role === "owner" ? "owners must transfer or delete shows first" : null;
}

export async function deleteAccount(db: TransactionalSql, userId: string, email: string): Promise<void> {
  await db.transaction((tx) => [
    tx`delete from subscriptions where subscriber_email = ${email}`,
    tx`delete from users where id = ${userId}`,
  ]);
}
