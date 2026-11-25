import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { auth } from "@/auth";
import ShowSpecForm from "@/components/ShowSpecForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Go back and change any earlier choice for a show: the setup form, filled in
// with what the show has now. Saving goes through PUT /api/shows/[id]/spec,
// which is owner-only (middleware) and validates like create.
export default async function EditShowPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  const { id } = await params;
  if (!owner) redirect(`/shows/${id}`);
  const rows = (await sql`select id, title from shows where id = ${id}`) as { id: string; title: string }[];
  if (!rows[0]) notFound();

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <Link href={`/shows/${id}`} className="btn secondary">
          ← Back to {rows[0].title}
        </Link>
      </header>
      <div className="container">
        <ShowSpecForm editShowId={id} />
      </div>
    </>
  );
}
