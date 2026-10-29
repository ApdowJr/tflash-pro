"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ErrorState } from "@/components/app/error-state";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * Next renders this when a server component or a client render throws, instead
 * of a blank page. The digest is the only detail a user sees; the full error
 * stays in the server log, correlated by request id.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // Structured, redacted log on the server route; the browser console keeps
    // the raw object for local debugging.
    console.error("[tflash] route error", error.digest ?? "no-digest", error.message);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center bg-background">
      <ErrorState
        eyebrow="Something broke · Khalad ayaa dhacay"
        title="This screen could not load"
        description="The page failed while rendering. Retrying usually fixes a temporary problem. If it keeps happening, open a new chat or check the deployment health endpoint."
        detail={error.digest ? `digest: ${error.digest}` : undefined}
        actions={(
          <>
            <Button onClick={reset} type="button">
              Try again · Isku day mar kale
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href="/">New chat · Wada hadal cusub</Link>
            </Button>
          </>
        )}
      />
    </main>
  );
}
