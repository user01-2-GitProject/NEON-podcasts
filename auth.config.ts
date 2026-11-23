import type { NextAuthConfig } from "next-auth";

export default {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    session({ session, token }) {
      session.user = { ...session.user, email: token.email, role: token.role } as typeof session.user;
      return session;
    },
  },
} satisfies NextAuthConfig;
