import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import authConfig from "@/auth.config";
import { sql } from "@/lib/db";
import { roleForEmail, validOwnerSecret, verifiedGoogleEmail, verifyPassword } from "@/lib/auth";

export const { handlers, auth } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
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
    ...authConfig.callbacks,
    signIn({ account, profile }) {
      return account?.provider !== "google" || verifiedGoogleEmail(profile) !== null;
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const email = verifiedGoogleEmail(profile);
        if (!email) throw new Error("Google email was not verified");
        const role = roleForEmail(email);
        const rows = (await sql`
          insert into users (email, password_hash, role, owner_approved)
          values (${email}, null, ${role}, true)
          on conflict (email) do update set
            password_hash = null,
            role = excluded.role,
            owner_approved = true
          returning id
        `) as { id: string }[];
        token.sub = rows[0].id;
        token.email = email;
        token.role = role;
        return token;
      }
      if (user) token.role = (user as { role: string }).role;
      return token;
    },
  },
});
