import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { sql } from "@/lib/db";
import { roleForEmail, validOwnerSecret, verifyPassword } from "@/lib/auth";

export const { handlers, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, ownerSecret: {} },
      async authorize(credentials) {
        const email = String(credentials.email || "").trim().toLowerCase();
        const password = String(credentials.password || "");
        if (!email || !password) return null;
        const rows = (await sql`select id, email, password_hash, owner_approved from users where email = ${email} limit 1`) as {
          id: string; email: string; password_hash: string | null; owner_approved: boolean;
        }[];
        const user = rows[0];
        if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) return null;
        const approved = user.owner_approved || validOwnerSecret(String(credentials.ownerSecret || ""));
        const role = approved ? roleForEmail(user.email) : "member";
        await sql`update users set role = ${role}, owner_approved = ${approved} where id = ${user.id}`;
        return { id: user.id, email: user.email, role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role: string }).role;
      return token;
    },
    session({ session, token }) {
      session.user = { ...session.user, role: token.role } as typeof session.user;
      return session;
    },
  },
});
