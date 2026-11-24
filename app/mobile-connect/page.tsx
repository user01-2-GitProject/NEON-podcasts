import { auth } from "@/auth";
import { allowedAppRedirect } from "@/lib/me-tokens";

export const dynamic = "force-dynamic";

// Confirmation page for "Sign in with browser" from the NEON app. Middleware
// sends signed-out visitors to /login first and brings them back here.
export default async function MobileConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const target = allowedAppRedirect(redirect);
  const session = await auth();
  const email = session?.user?.email ?? "";

  return (
    <main style={{ maxWidth: 420, margin: "15vh auto", padding: 24, textAlign: "center" }}>
      <h1>Connect the NEON app</h1>
      {target ? (
        <>
          <p>
            Sign the NEON app on this device in as <strong>{email}</strong>? You can revoke it anytime under
            Settings, Devices.
          </p>
          <form method="post" action="/api/me/tokens/connect">
            <input type="hidden" name="redirect" value={target} />
            <button type="submit">Connect app</button>
          </form>
        </>
      ) : (
        <p>This link is missing a valid app address. Open it from the NEON app&apos;s sign-in screen.</p>
      )}
    </main>
  );
}
