type TransactionalSql = {
  transaction: (callback: (tx: any) => any[]) => Promise<unknown[]>;
};

export function accountDeletionBlock(role: string, tokenLabel: string | null): { status: 403 | 409; error: string } | null {
  if (tokenLabel?.startsWith("agent:")) {
    return { status: 403, error: "agents can't delete the account" };
  }
  return role === "owner" ? { status: 409, error: "owners must transfer or delete shows first" } : null;
}

export async function deleteAccount(db: TransactionalSql, userId: string, email: string): Promise<void> {
  await db.transaction((tx) => [
    tx`delete from subscriptions where subscriber_email = ${email}`,
    tx`delete from users where id = ${userId}`,
  ]);
}
