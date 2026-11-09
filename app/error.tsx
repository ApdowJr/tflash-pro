"use client";

import { SafeLink } from "@/lib/safe-navigation";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/app/error-state";
import type { Language } from "@/components/settings/i18n";
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
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    // Structured, redacted log on the server route; the browser console keeps
    // the raw object for local debugging.
    console.error("[tflash] route error", error.digest ?? "no-digest", error.message);
  }, [error]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("tflash:language") === "so") setLanguage("so");
    } catch { /* ignore */ }
  }, []);

  const so = language === "so";

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center bg-background">
      <ErrorState
        eyebrow={so ? "Khalad ayaa dhacay" : "Something broke"}
        title={so ? "Shaashaddan lama soo rari karin" : "This screen could not load"}
        description={so
          ? "Boggu wuu fashilmay intii la soo rarayay. Dib u isku dayiddu badanaa way xallisaa dhibaato ku meel gaar ah. Haddii ay sii socoto, fur wada hadal cusub."
          : "The page failed while rendering. Retrying usually fixes a temporary problem. If it keeps happening, open a new chat or check the deployment health endpoint."}
        detail={error.digest ? `digest: ${error.digest}` : undefined}
        actions={(
          <>
            <Button onClick={reset} type="button">
              {so ? "Isku day mar kale" : "Try again"}
            </Button>
            <Button asChild type="button" variant="outline">
              <SafeLink href="/">{so ? "Wada hadal cusub" : "New chat"}</SafeLink>
            </Button>
          </>
        )}
      />
    </main>
  );
}
