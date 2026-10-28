"use client";
import { Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-card border border-line bg-graphite p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">Your data is safe. Try again; if it keeps happening, reload the page.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">Reference: {error.digest}</p>}
      <Button variant="primary" className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
