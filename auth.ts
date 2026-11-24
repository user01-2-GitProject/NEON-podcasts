import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import authConfig from "@/auth.config";
import { sql } from "@/lib/db";
import { roleForEmail, verifiedGoogleEmail } from "@/lib/auth";

export const { handlers, auth } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
