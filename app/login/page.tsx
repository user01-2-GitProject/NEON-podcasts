export const runtime = "nodejs";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <div className="container login-wrap">
      <div className="panel">
        <h2>
          <span style={{ color: "var(--accent)" }}>NEON</span> Podcasts
        </h2>
        <p className="muted">Enter your password to reach the dashboard.</p>
        <form method="post" action="/api/auth/login">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoFocus required />
          {error ? <p className="error">Wrong password — try again.</p> : null}
          <div style={{ marginTop: 14 }}>
            <button type="submit">Sign in</button>
          </div>
        </form>
      </div>
    </div>
  );
}
