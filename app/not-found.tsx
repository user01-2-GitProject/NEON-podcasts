import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container">
      <div className="panel">
        <h2>Not found</h2>
        <p className="muted">That page or show does not exist.</p>
        <Link href="/" className="btn secondary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
