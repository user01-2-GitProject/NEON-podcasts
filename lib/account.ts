type TransactionalSql = {
  transaction: (callback: (tx: any) => any[]) => Promise<unknown[]>;
};

export function accountDeletionBlock(role: string, tokenLabel: string | null): { status: 403 | 409; error: string } | null {
  if (tokenLabel?.startsWith("agent:")) {
    return { status: 403, error: "An app key can't delete the account. Sign in on the website to do it." };
  }
  return role === "owner" ? { status: 409, error: "Owners need to hand off or delete their shows before deleting the account." } : null;
}

export async function deleteAccount(db: TransactionalSql, userId: string, email: string): Promise<void> {
  await db.transaction((tx) => [
    tx`delete from subscriptions where subscriber_email = ${email}`,
    tx`delete from users where id = ${userId}`,
  ]);
}
