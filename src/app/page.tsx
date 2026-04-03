import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container stack">
      <h1>Home</h1>
      <p className="muted">
        This is a simple Next.js App Router app with Supabase email/password
        authentication.
      </p>
      <div className="row">
        <Link className="button" href="/login">
          Go to Login
        </Link>
        <Link className="button" href="/dashboard">
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}

