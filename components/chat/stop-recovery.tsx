"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
import { beginStop, cancelledStopTurns, clearStop, stopWarnings, type StopWarning } from "@/lib/stop-recovery";

type StreamEvent = { type: string; data?: unknown };
export function useStopRecovery(kind: string, userId: string, sessionId: string | undefined, events: readonly StreamEvent[]) {
  const identity = JSON.stringify([kind, userId, sessionId ?? null]);
  const current = useRef(identity); current.current = identity;
  const volatile = useRef<{ identity: string; warnings: StopWarning[] }>({ identity, warnings: [] });
  if (volatile.current.identity !== identity) volatile.current = { identity, warnings: [] };
  const [active, setActive] = useState<string[]>([]);
  const activeRef = useRef<string[]>([]);
  const [snapshot, setSnapshot] = useState<{ identity: string; warnings: StopWarning[]; unavailable: boolean }>({ identity: "", warnings: [], unavailable: true });
  const refresh = useCallback(() => {
    if (current.current !== identity) return;
    try {
      const stored = sessionId ? stopWarnings(kind, userId, sessionId) : [];
      setSnapshot({ identity, warnings: [...stored, ...volatile.current.warnings], unavailable: false });
    } catch { setSnapshot({ identity, warnings: [...volatile.current.warnings], unavailable: true }); }
  }, [identity, kind, userId, sessionId]);
  useEffect(() => {
    current.current = identity; refresh(); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); if (current.current === identity) current.current = ""; };
  }, [identity, refresh]);
  const warnings = snapshot.identity === identity ? snapshot.warnings : [];
  const unavailable = snapshot.identity !== identity || snapshot.unavailable;
  const begin = useCallback((turnId?: string) => {
    let key: string;
    try { if (!sessionId) throw new Error("No session"); key = beginStop(kind, userId, sessionId, turnId); }
    catch {
      // Stop is protective: even unavailable/full storage must not stop the
      // request. The warning survives only in this mounted component.
      key = `volatile:${Date.now()}:${Math.random()}`;
      volatile.current.warnings.push({ key, ...(turnId ? { turnId } : {}) });
    }
    activeRef.current = [...activeRef.current, key]; setActive(activeRef.current); refresh(); return key;
  }, [kind, userId, sessionId, refresh]);
  const done = useCallback((key: string) => {
    if (current.current !== identity) return;
    activeRef.current = activeRef.current.filter(item => item !== key); setActive(activeRef.current); refresh();
  }, [identity, refresh]);
  const remove = useCallback((key: string) => {
    if (volatile.current.warnings.some(item => item.key === key)) {
      volatile.current.warnings = volatile.current.warnings.filter(item => item.key !== key);
    } else clearStop(key);
  }, []);
  useEffect(() => {
    const cancelled = cancelledStopTurns(events);
    let changed = false;
    for (const warning of warnings) {
      if (warning.turnId && cancelled.has(warning.turnId) && !activeRef.current.includes(warning.key)) {
        try { remove(warning.key); changed = true; } catch { /* Keep the marker on deletion failure. */ }
      }
    }
    if (changed) refresh();
  }, [events, warnings, active, remove, refresh]);
  const review = useCallback((key: string) => {
    if (current.current !== identity || activeRef.current.includes(key)) return false;
    try {
      const all = [...(sessionId ? stopWarnings(kind, userId, sessionId) : []), ...volatile.current.warnings];
      if (!all.some(w => w.key === key)) return false;
      remove(key); refresh(); return true;
    } catch { refresh(); return false; }
  }, [identity, kind, userId, sessionId, remove, refresh]);
  const checkBlocked = useCallback(() => {
    if (current.current !== identity || volatile.current.warnings.length) return true;
    try { return !!sessionId && stopWarnings(kind, userId, sessionId).length > 0; } catch { return true; }
  }, [identity, kind, userId, sessionId]);
  return { warnings, unavailable, active, begin, done, review, checkBlocked };
}

export function StopRecoveryNotice({ warning, busy, review }: { warning: StopWarning; busy: boolean; review: (key: string) => boolean }) {
  const { t } = useAppSettings(); const [checked, setChecked] = useState(false), [failed, setFailed] = useState(false);
  return <section role="alert" className="mx-auto w-full max-w-2xl space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
    <p>{t("stopUncertain")}</p>
    {warning.key.startsWith("volatile:") ? <p>{t("stopStorageUnavailable")}</p> : null}
    <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />{t("stopReviewLabel")}</label>
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 whitespace-normal" disabled={!checked || busy} onClick={() => setFailed(!review(warning.key))}>{t("stopReviewButton")}</Button>
    {failed ? <p className="text-destructive">{t("controlActionReviewFailed")}</p> : null}
  </section>;
}
