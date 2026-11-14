import { Loader2 } from "lucide-react";

/** Suspense fallback while the session is checked on the server. */
export default function PageLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-20 text-ink-muted" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
