"use client";

import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Language } from "@/components/settings/i18n";

function readStoredLanguage(): Language {
  try {
    return window.localStorage.getItem("tflash:language") === "so" ? "so" : "en";
  } catch {
    return "en";
  }
}

/**
 * A quiet connection indicator.
 *
 * `navigator.onLine` only reports the browser's link state — it does not prove
 * that Tflash, Supabase, or a provider is reachable. So the banner never claims
 * "the server is up": it says the device is offline, which is exactly what the
 * browser knows, and stops a user from blaming a model for a dropped network.
 *
 * The recovery message is announced once and removed after a few seconds; the
 * offline state stays until the browser reports a connection again.
 */
export function ConnectivityBanner() {
  const [offline, setOffline] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    setLanguage(readStoredLanguage());
    const onLanguageEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "so" || detail === "en") setLanguage(detail);
      else setLanguage(readStoredLanguage());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "tflash:language") setLanguage(readStoredLanguage());
    };
    // `navigator.onLine` starts optimistic in some browsers; only report what
    // the events and the initial read agree on.
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const onOffline = () => {
      setRecovered(false);
      setOffline(true);
    };
    const onOnline = () => {
      setOffline(false);
      setRecovered(true);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("tflash:language-change", onLanguageEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("tflash:language-change", onLanguageEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!recovered) return;
    const timer = window.setTimeout(() => setRecovered(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [recovered]);

  if (!offline && !recovered) return null;

  return (
    <div
      aria-live="polite"
      className="tf-safe-x fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-2"
      role="status"
    >
      <div
        className={
          offline
            ? "flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-900 shadow-sm backdrop-blur dark:text-amber-200"
            : "flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-900 shadow-sm backdrop-blur dark:text-emerald-200"
        }
      >
        {offline ? (
          <>
            <WifiOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              {language === "so"
                ? "Internet-ka ayaa go'an. Farriimuhu ma bixi doonaan ilaa uu soo noqdo."
                : "You are offline. Messages will fail until the connection returns."}
            </span>
          </>
        ) : (
          <>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            <span>{language === "so" ? "Internet-ka wuu soo noqday." : "Back online."}</span>
          </>
        )}
      </div>
    </div>
  );
}
