import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LiveSessions from "@/components/LiveSessions";
import ThemeToggle from "@/components/ThemeToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/live");

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts · Live
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/" className="btn secondary">All shows</Link>
          <Link href="/settings" className="btn secondary">Settings</Link>
        </div>
        <ThemeToggle />
      </header>

      <div className="container">
        <LiveSessions />
      </div>
    </>
  );
}
