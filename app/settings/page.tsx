import Link from "next/link";
import SettingsForm from "@/components/SettingsForm";
import DevicesPanel from "@/components/DevicesPanel";
import TokenAdmin from "@/components/TokenAdmin";
import DeleteAccountPanel from "@/components/DeleteAccountPanel";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/settings");
  const isOwner = (session.user as { role?: string } | undefined)?.role === "owner";
  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <Link href="/" className="btn secondary">
          ← All shows
        </Link>
      </header>

      <div className="container">
        <DevicesPanel />
        <DeleteAccountPanel />
        {isOwner ? <SettingsForm /> : null}
        {isOwner ? <TokenAdmin /> : null}
      </div>
    </>
  );
}
