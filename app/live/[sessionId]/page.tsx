import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import LiveRoom from "@/components/LiveRoom";
import ThemeToggle from "@/components/ThemeToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LiveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=${encodeURIComponent(`/live/${sessionId}`)}`);

  // Match the API's isLiveOwner(): role owner AND owner_approved. The routes
  // still enforce this independently; this only decides what the UI shows.
  let isOwner = (session.user as { role?: string } | undefined)?.role === "owner";
  const email = session.user.email?.toLowerCase();
  if (isOwner && email) {
    try {
      const rows = (await sql`
        select owner_approved from users where email = ${email} limit 1
      `) as { owner_approved: boolean }[];
      isOwner = rows[0]?.owner_approved === true;
    } catch {
      isOwner = false;
    }
  }

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts · Live
        </h1>
        <Link href="/live" className="btn secondary">← Live sessions</Link>
        <ThemeToggle />
      </header>

      <div className="container">
        <LiveRoom sessionId={sessionId} isOwner={isOwner} />
      </div>
    </>
  );
}
