import Link from "next/link";
import { redirect } from "next/navigation";
import ShowWizard from "@/components/ShowWizard";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The one-question-per-page new-show wizard. Owners only; members can browse
// and follow, but only owners make shows.
export default async function NewShowPage() {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  if (!owner) redirect("/");
  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <Link href="/" className="btn secondary">Cancel</Link>
      </header>
      <ShowWizard />
    </>
  );
}
