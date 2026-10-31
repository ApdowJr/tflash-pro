"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { waitWithAbort } from "@/lib/abortable";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
import { beginInputResponse, clearInputResponse, inputRequestDigest, inputResponseWarnings, resolvedInputRequestIds, type InputResponseWarning } from "@/lib/input-response-recovery";

type StreamEvent = { type: string; data?: unknown };
export function useInputResponseRecovery(kind: string, userId: string, sessionId: string | undefined, events: readonly StreamEvent[]) {
  const identity = JSON.stringify([kind, userId, sessionId ?? null]);
  const current = useRef(identity); current.current = identity;
  const preparing = useRef(false);
  const [preparingUi, setPreparingUi] = useState(false);
  const [active, setActive] = useState<string[]>([]);
  const failed = useRef({ identity, value: false });
  if (failed.current.identity !== identity) failed.current = { identity, value: false };
  const [snapshot, setSnapshot] = useState<{ identity: string; warnings: InputResponseWarning[]; unavailable: boolean }>({ identity: "", warnings: [], unavailable: true });
  const refresh = useCallback(() => {
    if (current.current !== identity) return;
    if (!sessionId) { setSnapshot({ identity, warnings: [], unavailable: false }); return; }
    try { setSnapshot({ identity, warnings: inputResponseWarnings(kind, userId, sessionId), unavailable: failed.current.value }); }
    catch { setSnapshot({ identity, warnings: [], unavailable: true }); }
  }, [identity, kind, userId, sessionId]);
  useEffect(() => {
    current.current = identity; refresh(); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); if (current.current === identity) current.current = ""; };
  }, [identity, refresh]);
  const warnings = snapshot.identity === identity ? snapshot.warnings : [];
  const unavailable = snapshot.identity !== identity || snapshot.unavailable;
  useEffect(() => {
    if (!sessionId || !warnings.some(w => w.digest && w.mode === "explicit")) return;
    let live = true;
    const ids = resolvedInputRequestIds(events);
    if (!ids.length) return;
    void Promise.all(ids.map(id => inputRequestDigest(id))).then(digests => {
      if (!live || current.current !== identity) return;
      try {
        const resolved = new Set(digests);
        let changed = false;
        for (const warning of inputResponseWarnings(kind, userId, sessionId)) if (warning.mode === "explicit" && warning.digest && resolved.has(warning.digest)) { clearInputResponse(warning.key); changed = true; }
        if (changed) refresh();
      } catch { failed.current.value = true; refresh(); }
    }).catch(() => { if (live && current.current === identity) { failed.current.value = true; refresh(); } });
    return () => { live = false; };
  }, [events, identity, kind, userId, sessionId, warnings, refresh]);
  const begin = useCallback(async (requestId: string, mode: "explicit" | "message" = "explicit") => {
    if (!sessionId || preparing.current || current.current !== identity) throw new Error("Response unavailable.");
    preparing.current = true; setPreparingUi(true);
    try {
      const digest = await waitWithAbort(inputRequestDigest(requestId), AbortSignal.timeout(5_000));
      if (current.current !== identity) throw new Error("Account changed.");
      const key = beginInputResponse(kind, userId, sessionId, digest, mode);
      failed.current.value = false;
      setActive(items => [...items, key]); refresh(); return key;
    } catch (error) {
      if (current.current === identity) {
        if (!(error instanceof Error && error.message === "Review required.")) failed.current.value = true;
        refresh();
      }
      throw error;
    } finally { preparing.current = false; if (current.current === identity) setPreparingUi(false); }
  }, [sessionId, identity, kind, userId, refresh]);
  const done = useCallback((key: string) => { if (current.current === identity) setActive(items => items.filter(item => item !== key)); }, [identity]);
  // Called only before agent.respond has been invoked.
  const discard = useCallback((key: string) => { try { clearInputResponse(key); refresh(); } catch { if (current.current === identity) { failed.current.value = true; refresh(); } } done(key); }, [identity, refresh, done]);
  const review = useCallback((key: string) => {
    if (!sessionId || active.includes(key) || preparing.current) return false;
    try { if (!inputResponseWarnings(kind, userId, sessionId).some(w => w.key === key)) return false; clearInputResponse(key); refresh(); return true; }
    catch { failed.current.value = true; refresh(); return false; }
  }, [sessionId, active, kind, userId, refresh]);
  const isPresent = useCallback((key: string) => {
    if (!sessionId || current.current !== identity) return false;
    try { const warnings = inputResponseWarnings(kind, userId, sessionId); return warnings.length === 1 && warnings[0].key === key; }
    catch { failed.current.value = true; refresh(); return false; }
  }, [sessionId, identity, kind, userId, refresh]);
  const checkBlocked = useCallback((hasOpenInput: boolean) => {
    if (!sessionId) return false;
    if (preparing.current) return true;
    try { return inputResponseWarnings(kind, userId, sessionId).length > 0 || (hasOpenInput && failed.current.value); }
    catch { return hasOpenInput; }
  }, [kind, userId, sessionId]);
  return { warnings, unavailable, preparing: preparingUi, active, begin, done, discard, review, isPresent, checkBlocked };
}

export function InputResponseNotice({ warning, busy, review }: { warning: InputResponseWarning; busy: boolean; review: (key: string) => boolean }) {
  const { t } = useAppSettings(); const [checked, setChecked] = useState(false), [failed, setFailed] = useState(false);
  return <section role="alert" className="mx-auto w-full max-w-2xl space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
    <p>{t("inputResponseUncertain")}</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />{t("inputResponseReviewLabel")}</label>
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 whitespace-normal" disabled={!checked || busy} onClick={() => setFailed(!review(warning.key))}>{t("inputResponseReviewButton")}</Button>
    {failed ? <p className="text-destructive">{t("controlActionReviewFailed")}</p> : null}
  </section>;
}
