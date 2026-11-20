import Link from "next/link";
import SettingsForm from "@/components/SettingsForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
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
        <SettingsForm />
      </div>
    </>
  );
}
