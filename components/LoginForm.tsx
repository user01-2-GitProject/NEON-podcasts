"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginForm({ error, registered, next }: { error?: string; registered: boolean; next?: string }) {
  const [message, setMessage] = useState(error === "owner" ? "Owner enrollment requires the owner secret." : error === "exists" ? "That account already exists. Sign in above." : error === "invalid" ? "Enter a valid email and a password of at least 12 characters." : error ? "Sign-in failed. Try again." : "");
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function login(form: FormData) {
    setMessage("");
    const result = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      ownerSecret: form.get("ownerSecret"),
      redirect: false,
    });
    if (result?.error) setMessage("Check your email and password, then try again.");
    else window.location.assign(destination);
  }

  return (
    <div className="container login-wrap">
      <div className="panel">
        <h2><span style={{ color: "var(--accent)" }}>NEON</span> Podcasts</h2>
        <p className="muted">Sign in to view the shared shows and episodes.</p>
        {registered ? <p className="muted">Account created. Sign in below.</p> : null}
        {message ? <p className="error">{message}</p> : null}
        <button type="button" autoFocus onClick={() => signIn("google", { redirectTo: destination })}>
          Sign in with Google
        </button>
        <hr style={{ margin: "24px 0" }} />
        <h3>Use a password instead</h3>
        <form action={login}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <label htmlFor="owner-login-secret">Owner enrollment secret (first owner sign-in only)</label>
          <input id="owner-login-secret" name="ownerSecret" type="password" autoComplete="off" />
          <div style={{ marginTop: 14 }}><button type="submit">Sign in</button></div>
        </form>
        <hr style={{ margin: "24px 0" }} />
        <h3>Create a password account</h3>
        <p className="muted">New accounts can read shows. Owners are set by the site administrator.</p>
        <form method="post" action="/api/auth/register">
          <label htmlFor="register-email">Email</label>
          <input id="register-email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="register-password">Password (12 characters minimum)</label>
          <input id="register-password" name="password" type="password" autoComplete="new-password" minLength={12} required />
          <label htmlFor="owner-register-secret">Owner enrollment secret (owners only)</label>
          <input id="owner-register-secret" name="ownerSecret" type="password" autoComplete="off" />
          <div style={{ marginTop: 14 }}><button type="submit" className="secondary">Create account</button></div>
        </form>
      </div>
    </div>
  );
}
