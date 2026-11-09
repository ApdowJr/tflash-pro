"use client";

import { SafeLink } from "@/lib/safe-navigation";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/app/error-state";
import type { Language } from "@/components/settings/i18n";
import { Button } from "@/components/ui/button";

export function NotFoundState() {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    const syncLanguage = () => {
      try {
        setLanguage(window.localStorage.getItem("tflash:language") === "so" ? "so" : "en");
      } catch { /* ignore */ }
    };
    syncLanguage();
    window.addEventListener("tflash:language-change", syncLanguage);
    window.addEventListener("storage", syncLanguage);
    return () => {
      window.removeEventListener("tflash:language-change", syncLanguage);
      window.removeEventListener("storage", syncLanguage);
    };
  }, []);

  const so = language === "so";

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center bg-background">
      <ErrorState
        eyebrow={so ? "404 · Boggan lama helin" : "404 · Page not found"}
        title={so ? "Boggan ma jiro" : "This page does not exist"}
        description={so
          ? "Xiriirku wuu duugoobi karaa, ama wada hadalka waa laga saari karay. Wada hadalladaada kale weli waxay ku jiraan baarka dhinaca."
          : "The link may be old, or the conversation may have been removed. Your other conversations are still in the sidebar."}
        actions={(
          <Button asChild type="button">
            <SafeLink href="/">{so ? "Bilow wada hadal cusub" : "Start a new chat"}</SafeLink>
          </Button>
        )}
      />
    </main>
  );
}
