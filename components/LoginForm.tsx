"use client";

import { signIn } from "next-auth/react";

export default function LoginForm({ error, next }: { error?: string; registered?: boolean; next?: string }) {
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  const message = error ? "Sign-in failed. Try again." : "";

  return (
    <div className="container login-wrap">
      <div className="panel">
        <h2><span style={{ color: "var(--accent)" }}>NEON</span> Podcasts</h2>
        <p className="muted">Sign in with Google to view the shared shows and episodes.</p>
        {message ? <p className="error">{message}</p> : null}
        <button type="button" autoFocus onClick={() => signIn("google", { redirectTo: destination })}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
