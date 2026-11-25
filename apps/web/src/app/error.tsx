"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-10">
      <h1
        className="text-2xl font-semibold"
        style={{ fontFamily: "var(--font-display), serif" }}
      >
        Something went wrong
      </h1>

      <div className="panel space-y-3 p-4 text-sm leading-relaxed">
        <p>
          The page could not load its data. On a new Vercel project this is
          usually a missing hosted database. Local SQLite cannot persist in
          production.
        </p>
        <p className="text-xs text-[var(--muted)]">
          Open /api/health for the exact database error.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Create a free database at{" "}
            <a
              className="text-[var(--accent)] underline"
              href="https://supabase.com"
              target="_blank"
              rel="noreferrer"
            >
              supabase.com
            </a>
          </li>
          <li>
            In Vercel → Project → Settings → Environment Variables, add{" "}
            <code>SUPABASE_DATABASE_URL</code> with the Postgres connection
            string.
          </li>
          <li>Redeploy the project.</li>
        </ol>
        {error.message ? (
          <p className="text-xs text-[var(--muted)]">{error.message}</p>
        ) : null}
        {error.digest ? (
          <p className="text-xs text-[var(--muted)]">Digest: {error.digest}</p>
        ) : null}
      </div>

      <button type="button" className="btn-primary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
