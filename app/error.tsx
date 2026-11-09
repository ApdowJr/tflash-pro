"use client";

import { SafeLink } from "@/lib/safe-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/app/error-state";
import type { Language } from "@/components/settings/i18n";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * Next renders this when a server component or a client render throws, instead
 * of a blank page. The digest is the only detail a user sees; the full error
 * stays in the server log, correlated by request id.
 *
 * Two behaviours matter here:
 *
 * - A transient render failure (a chunk that had not finished loading, an
 *   unresolved promise race) usually clears on a second attempt, so the screen
 *   retries itself once before asking the reader to do anything.
 * - A failure that survives that retry needs the reader to see the reference
 *   code and be able to reload, because the in-app reset re-runs the same
 *   component tree. Panels that can fail on their own are wrapped in
 *   `LazyPanel` (`components/app/lazy-panel.tsx`), so this screen is only
 *   reached for whole-page failures.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const [language, setLanguage] = useState<Language>("en");
  const [reloading, setReloading] = useState(false);
  const autoRetried = useRef(false);

  useEffect(() => {
    // Structured, redacted log on the server route; the browser console keeps
    // the raw object for local debugging.
    console.error("[tflash] route error", error.digest ?? "no-digest", error.name, error.message, error.stack);
  }, [error]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("tflash:language") === "so") setLanguage("so");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // One automatic attempt per boundary instance. The ref survives the reset,
    // so a deterministic failure shows this screen instead of looping.
    if (autoRetried.current) return;
    autoRetried.current = true;
    const timer = window.setTimeout(() => reset(), 600);
    return () => window.clearTimeout(timer);
  }, [reset]);

  const reload = useCallback(() => {
    setReloading(true);
    window.location.reload();
  }, []);

  const so = language === "so";

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center bg-background">
      <ErrorState
        eyebrow={so ? "Khalad ayaa dhacay" : "Something broke"}
        title={so ? "Shaashaddan lama soo rari karin" : "This screen could not load"}
        description={so
          ? "Boggu wuu fashilmay intii la soo rarayay. Hal mar ayaa si otomaatig ah dib loo isku dayay. Haddii ay sii socoto, bogga dib u cusboonaysii ama fur wada hadal cusub; wada hadalladaadii waxba kama lumaan."
          : "The page failed while rendering. It retried once automatically. If it still fails, reload the page or open a new chat; your conversations are not affected."}
        detail={error.digest ? `digest: ${error.digest}` : undefined}
        actions={(
          <>
            <Button onClick={reset} type="button">
              {so ? "Isku day mar kale" : "Try again"}
            </Button>
            <Button disabled={reloading} onClick={reload} type="button" variant="outline">
              {so ? "Dib u cusboonaysii" : "Reload"}
            </Button>
            <Button asChild type="button" variant="ghost">
              <SafeLink href="/">{so ? "Wada hadal cusub" : "New chat"}</SafeLink>
            </Button>
          </>
        )}
      />
    </main>
  );
}
