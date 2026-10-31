"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
import { beginSharedDispatch, clearOwnedSharedDispatch, clearReviewedSharedDispatch, sharedDispatchWarnings, type SharedDispatchWarning } from "@/lib/shared-dispatch-recovery";

export function useSharedDispatchRecovery(kind: string, userId: string, sessionId: string | undefined) {
  const identity = JSON.stringify([kind, userId, sessionId ?? null]);
  const current = useRef(identity); current.current = identity;
  const owned = useRef<{ identity: string; keys: Set<string> }>({ identity, keys: new Set() });
  if (owned.current.identity !== identity) owned.current = { identity, keys: new Set() };
  const [snapshot, setSnapshot] = useState<{ identity: string; warnings: SharedDispatchWarning[]; unavailable: boolean }>({ identity: "", warnings: [], unavailable: true });
  const [writeFailed, setWriteFailed] = useState(false);
  const read = useCallback(() => sessionId ? sharedDispatchWarnings(kind, userId, sessionId).filter(w => !owned.current.keys.has(w.key)) : [], [kind, userId, sessionId]);
  const refresh = useCallback(() => {
    if (current.current !== identity) return;
    try { setSnapshot({ identity, warnings: read(), unavailable: false }); }
    catch { setSnapshot({ identity, warnings: [], unavailable: true }); }
  }, [identity, read]);
  useEffect(() => {
    current.current = identity; refresh(); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); if (current.current === identity) current.current = ""; };
  }, [identity, refresh]);
  const warnings = snapshot.identity === identity ? snapshot.warnings : [];
  const unavailable = snapshot.identity !== identity || snapshot.unavailable;
  const checkBlocked = useCallback(() => {
    if (current.current !== identity) return true;
    try { return read().length > 0; } catch { return true; }
  }, [identity, read]);
  const begin = useCallback(() => {
    if (!sessionId || current.current !== identity || checkBlocked()) throw new Error("Shared dispatch requires review.");
    let key: string;
    try { key = beginSharedDispatch(kind, userId, sessionId); }
    catch {
      // Preserve the existing same-tab fallback; warn that other tabs and
      // reloads may not see this send. Never claim that a marker is a lock.
      setWriteFailed(true); return undefined;
    }
    owned.current.keys.add(key);
    try {
      // A second observation narrows simultaneous-tab races but is not an
      // atomic compare-and-set or a cross-tab lock.
      if (read().length) throw new Error("Shared dispatch requires review.");
    } catch (error) {
      try { clearOwnedSharedDispatch(key, sessionId); } catch { /* Keep a recoverable marker. */ }
      owned.current.keys.delete(key); refresh(); throw error;
    }
    refresh(); return key;
  }, [kind, userId, sessionId, identity, checkBlocked, read, refresh]);
  const finish = useCallback((key: string | undefined, clean: boolean) => {
    if (!key || current.current !== identity) return;
    if (clean && sessionId) {
      try { clearOwnedSharedDispatch(key, sessionId); } catch { /* An uncertain/stale marker is safer than losing it. */ }
    }
    owned.current.keys.delete(key); refresh();
  }, [identity, sessionId, refresh]);
  const review = useCallback((warning: SharedDispatchWarning) => {
    const { key, raw } = warning;
    if (current.current !== identity || owned.current.keys.has(key)) return false;
    try {
      if (!read().some(w => w.key === key && w.raw === raw)) { refresh(); return false; }
      clearReviewedSharedDispatch(key, raw); refresh(); return true;
    } catch { refresh(); return false; }
  }, [identity, read, refresh]);
  return { warnings, unavailable, writeFailed, checkBlocked, begin, finish, review };
}

export function SharedDispatchNotice({ warning, review }: { warning: SharedDispatchWarning; review: (warning: SharedDispatchWarning) => boolean }) {
  const { t } = useAppSettings(); const [checkedValue, setCheckedValue] = useState<{ raw: string | null }>(), [failed, setFailed] = useState(false);
  const checked = checkedValue !== undefined && checkedValue.raw === warning.raw;
  return <section role="alert" className="mx-auto w-full max-w-2xl space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
    <p>{t("sharedDispatchUnknown")}</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setCheckedValue(e.target.checked ? { raw: warning.raw } : undefined)} />{t("sharedDispatchReviewed")}</label>
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 whitespace-normal" disabled={!checked} onClick={() => setFailed(!review(warning))}>{t("sharedDispatchReviewButton")}</Button>
    {failed ? <p className="text-destructive">{t("controlActionReviewFailed")}</p> : null}
  </section>;
}
