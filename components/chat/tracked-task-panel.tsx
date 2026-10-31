"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
import { useControlRecovery, ControlRecoveryNotice } from "./control-recovery";
import { fetchCatalogResponse, readCatalogJson } from "@/lib/catalog-fetch";
import { parseTaskSnapshot } from "@/lib/control-snapshot";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
import { TaskContinuation } from "./task-continuation";
import type { TrackedTask } from "@/lib/tracked-task";
export function TrackedTaskPanel({
  sessionId,
  ownerProof,
  continuationDisabled,
  onContinue,
}: {
  sessionId: string;
  ownerProof?: string;
  continuationDisabled: boolean;
  onContinue: (attemptId: string) => Promise<void>;
}) {
  const { t, accountId, accountKind } = useAppSettings();
  const recovery = useControlRecovery("control-task", sessionId);
  const [open, setOpen] = useState(false),
    [task, setTask] = useState<TrackedTask | null>(),
    [objective, setObjective] = useState(""),
    [path, setPath] = useState(""),
    [sha256, setSha256] = useState(""),
    [budget, setBudget] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<"unavailable" | "conflict">();
  const url = `/api/chats/${encodeURIComponent(sessionId)}/task`;
  const pending = useRef<AbortController | undefined>(undefined);
  const identity = `${accountKind}:${accountId}:${sessionId}:${ownerProof ?? ""}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [snapshotIdentity, setSnapshotIdentity] = useState(identity);
  const sameScope = snapshotIdentity === identity;
  useEffect(() => {
    setSnapshotIdentity(identity); setTask(undefined); setError(undefined); setBusy(false); setObjective(""); setPath(""); setSha256(""); setBudget(0);
    return () => { const active = pending.current; pending.current = undefined; active?.abort(); };
  }, [url, ownerProof, identity]);
  const request = useCallback(
    async (method: "GET" | "PUT" | "DELETE", body?: object) => {
      if (pending.current) return;
      let marker: string | undefined;
      if (method !== "GET") {
        try { marker = recovery.begin(method === "PUT" ? "save" : "cancel"); }
        catch { setError("unavailable"); return; }
      }
      const controller = new AbortController();
      pending.current = controller;
      const current = () => pending.current === controller && !controller.signal.aborted && currentIdentity.current === identity;
      setBusy(true); setError(undefined);
      try {
        const { response: r, signal } = await fetchCatalogResponse(url, {
          method, cache: "no-store", signal: controller.signal,
          headers: { "x-tflash-expected-user-id": accountId, "x-tflash-expected-account-kind": accountKind,
            ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}),
            ...(method !== "GET" ? { "content-type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }, 12_000);
        if (!r.ok) {
          let notStarted = false;
          if (marker && [400, 403, 404, 409, 413, 415].includes(r.status)) {
            try {
              const rejection = await readCatalogJson(r, signal, 16 * 1024);
              notStarted = Boolean(rejection && typeof rejection === "object" && !Array.isArray(rejection) && (rejection as { changeNotStarted?: unknown }).changeNotStarted === true);
            } catch { /* A missing or stalled rejection is unconfirmed. */ }
          } else if (r.body) void r.body.cancel().catch(() => {});
          if (marker && current() && notStarted) { recovery.finish(marker); marker = undefined; }
          throw new Error(r.status === 409 && notStarted ? "conflict" : "unavailable");
        }
        const result = parseTaskSnapshot(await readCatalogJson(r, signal, 128 * 1024));
        if (!result) throw new Error("unavailable");
        if (!current()) return;
        if (marker) { recovery.finish(marker); marker = undefined; }
        setTask(result.task);
      } catch (reason) {
        if (current()) {
          recovery.refresh(); setTask(undefined);
          setError(reason instanceof Error && reason.message === "conflict" ? "conflict" : "unavailable");
        }
      } finally {
        if (current()) { pending.current = undefined; setBusy(false); }
      }
    },
    [url, ownerProof, accountId, accountKind, identity, recovery.begin, recovery.finish, recovery.refresh],
  );
  useEffect(() => {
    if (open) void request("GET");
  }, [open, request]);
  const visibleTask = sameScope ? task : undefined;
  return (
    <details
      className="mx-auto w-full max-w-2xl rounded-lg border bg-card text-xs"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer px-3 py-3">
        {t("trackedTaskTitle")}
      </summary>
      {open ? (
        <div className="space-y-3 p-3 pt-0">
          <p>{t("trackedTaskDescription")}</p>
          <p className="text-muted-foreground">{t("trackedTaskLimit")}</p>
          {recovery.unavailable ? <p role="alert" className="text-destructive">{t("controlRecoveryUnavailable")}</p> : null}
          {recovery.warnings.map((warning) => <ControlRecoveryNotice key={warning.key} warning={warning} review={recovery.review} busy={busy} />)}
          {sameScope && error ? (
            <p role="alert" className="text-destructive">
              {t(error === "conflict" ? "trackedTaskConflict" : "trackedTaskUnavailable")}
            </p>
          ) : null}
          {visibleTask ? (
            <div className="space-y-1 break-words" role="status">
              <p>
                <strong>{visibleTask.objective}</strong>
              </p>
              <p>
                {visibleTask.path} · SHA-256:{" "}
                <span className="break-all">{visibleTask.sha256}</span>
              </p>
              <p>
                {t(
                  visibleTask.state === "criterion_matched"
                    ? "trackedTaskMatched"
                    : visibleTask.state === "cancelled"
                      ? "trackedTaskCancelled"
                      : "trackedTaskAwaiting",
                )}
              </p>
              {visibleTask.reason ? <p>{visibleTask.reason}</p> : null}
              {visibleTask.verifiedAt ? (
                <p>
                  {t("trackedTaskVerifiedAt")}{" "}
                  {new Date(visibleTask.verifiedAt).toLocaleString()}
                </p>
              ) : null}
              {visibleTask.state !== "cancelled" ? (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={busy || recovery.unavailable || recovery.warnings.length > 0}
                  onClick={() => void request("DELETE", { expectedRevision: visibleTask.revision })}
                >
                  {t("trackedTaskCancel")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {visibleTask ? <TaskContinuation sessionId={sessionId} ownerProof={ownerProof} task={visibleTask} disabled={continuationDisabled || recovery.unavailable || recovery.warnings.length > 0} onContinue={onContinue} onRefreshTask={() => void request("GET")} /> : null}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (visibleTask === undefined) return;
              void request("PUT", {
                task: { objective, path, sha256, continuationBudget: budget },
                expectedRevision: visibleTask?.revision ?? null,
              });
            }}
          >
            <label className="flex flex-col gap-1">
              {t("trackedTaskObjective")}
              <input
                className="min-h-11 rounded-md border bg-background px-2"
                required
                maxLength={500}
                value={sameScope ? objective : ""}
                onChange={(e) => setObjective(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              {t("trackedTaskPath")}
              <input
                className="min-h-11 rounded-md border bg-background px-2"
                required
                maxLength={200}
                placeholder="output.txt"
                value={sameScope ? path : ""}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              {t("trackedTaskHash")}
              <input
                className="min-h-11 rounded-md border bg-background px-2"
                required
                pattern="[0-9a-fA-F]{64}"
                value={sameScope ? sha256 : ""}
                onChange={(e) => setSha256(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">{t("boundedContinuationBudget")}
              <select className="min-h-11 rounded-md border bg-background px-2" value={sameScope ? budget : 0} onChange={(e) => setBudget(Number(e.target.value))}>
                {[0, 1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <Button type="submit" size="sm" disabled={busy || visibleTask === undefined || recovery.unavailable || recovery.warnings.length > 0}>
              {t("trackedTaskSave")}
            </Button>
          </form>
          <Button
            size="sm"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void request("GET")}
          >
            {t("taskRefresh")}
          </Button>
        </div>
      ) : null}
    </details>
  );
}
