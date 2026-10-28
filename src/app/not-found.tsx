import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gold">404</p>
      <h1 className="mt-3 text-xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
      <Link href="/home" className="mt-6 text-sm text-gold hover:underline">
        Back to Home
      </Link>
    </div>
  );
}
