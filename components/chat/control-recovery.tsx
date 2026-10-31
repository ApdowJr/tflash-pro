"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettings } from "@/components/settings/app-settings";
import { Button } from "@/components/ui/button";
import { beginControlAction, clearControlAction, controlWarnings, type ControlAction, type ControlScope, type ControlWarning } from "@/lib/control-action-recovery";

export function useControlRecovery(scope: ControlScope, sessionId: string) {
  const { accountId, accountKind } = useAppSettings();
  const identity = `${accountKind}:${accountId}:${sessionId}:${scope}`;
  const writeStatus = useRef({ identity, failed: false });
  if (writeStatus.current.identity !== identity) writeStatus.current = { identity, failed: false };
  const [snapshot, setSnapshot] = useState<{ identity: string; warnings: ControlWarning[]; unavailable: boolean }>({ identity: "", warnings: [], unavailable: true });
  const refresh = useCallback(() => {
    try { setSnapshot({ identity, warnings: controlWarnings(scope, accountKind, accountId, sessionId), unavailable: writeStatus.current.failed }); }
    catch { setSnapshot({ identity, warnings: [], unavailable: true }); }
  }, [identity, scope, accountKind, accountId, sessionId]);
  useEffect(() => {
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [refresh]);
  const begin = useCallback((action: ControlAction, emergency = false) => {
    // Read again at dispatch, not just from a possibly stale render snapshot.
    try {
      if (!emergency && controlWarnings(scope, accountKind, accountId, sessionId).length) {
        refresh();
        throw new Error("Pending review.");
      }
      const key = beginControlAction(scope, accountKind, accountId, sessionId, action);
      writeStatus.current.failed = false;
      refresh();
      return key;
    } catch (error) {
      if (!(error instanceof Error && error.message === "Pending review.")) {
        writeStatus.current.failed = true;
        setSnapshot((current) => ({ identity, warnings: current.identity === identity ? current.warnings : [], unavailable: true }));
      }
      throw error;
    }
  }, [scope, accountKind, accountId, sessionId, identity, refresh]);
  const finish = useCallback((key: string) => { clearControlAction(key); refresh(); }, [refresh]);
  const review = useCallback((key: string) => {
    try {
      if (!controlWarnings(scope, accountKind, accountId, sessionId).some((item) => item.key === key)) return false;
      clearControlAction(key); refresh(); return true;
    } catch { refresh(); return false; }
  }, [scope, accountKind, accountId, sessionId, refresh]);
  return { warnings: snapshot.identity === identity ? snapshot.warnings : [], unavailable: snapshot.identity !== identity || snapshot.unavailable, begin, finish, review, refresh };
}

export function ControlRecoveryNotice({ warning, review, busy }: { warning: ControlWarning; review: (key: string) => boolean; busy: boolean }) {
  const { t } = useAppSettings();
  const [checked, setChecked] = useState(false), [failed, setFailed] = useState(false);
  return <div className="space-y-2 rounded-md border border-destructive/40 p-2" role="alert">
    <p>{t("controlActionUncertain")}</p>
    <p className="font-medium">{t(warning.action === "grant" ? "controlActionGrant" : warning.action === "revoke" ? "controlActionRevoke" : warning.action === "revoke-all" ? "controlActionRevokeAll" : warning.action === "save" ? "controlActionSave" : warning.action === "cancel" ? "controlActionCancel" : warning.action === "reserve" ? "controlActionReserve" : warning.action === "begin" ? "controlActionBegin" : warning.action === "hold" ? "controlActionHold" : warning.action === "resolve" ? "controlActionResolve" : "controlActionUnknown")}</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{t("controlActionReviewLabel")}</label>
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-10 whitespace-normal" disabled={!checked || busy} onClick={() => setFailed(!review(warning.key))}>{t("controlActionReviewButton")}</Button>
    {failed ? <p className="text-destructive">{t("controlActionReviewFailed")}</p> : null}
  </div>;
}
