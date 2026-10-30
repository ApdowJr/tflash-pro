"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
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
  const { t } = useAppSettings();
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
  useEffect(() => {
    setTask(undefined); setError(undefined); setBusy(false); setObjective(""); setPath(""); setSha256(""); setBudget(0);
    return () => { const active = pending.current; pending.current = undefined; active?.abort(); };
  }, [url, ownerProof]);
  const request = useCallback(
    async (method: "GET" | "PUT" | "DELETE", body?: object) => {
      if (pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      setError(undefined);
      try {
        const r = await fetch(url, {
          method,
          cache: "no-store",
          signal: controller.signal,
          headers: {
            ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}),
            ...(method !== "GET" ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = (await r.json()) as { task?: TrackedTask | null };
        if (!r.ok || result.task === undefined) throw new Error(r.status === 409 ? "conflict" : "unavailable");
        if (pending.current !== controller) return;
        setTask(result.task);
      } catch (reason) {
        if (pending.current === controller) {
          setTask(undefined);
          setError(reason instanceof Error && reason.message === "conflict" ? "conflict" : "unavailable");
        }
      } finally {
        if (pending.current === controller) { pending.current = undefined; setBusy(false); }
      }
    },
    [url, ownerProof],
  );
  useEffect(() => {
    if (open) void request("GET");
  }, [open, request]);
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
          {error ? (
            <p role="alert" className="text-destructive">
              {t(error === "conflict" ? "trackedTaskConflict" : "trackedTaskUnavailable")}
            </p>
          ) : null}
          {task ? (
            <div className="space-y-1 break-words" role="status">
              <p>
                <strong>{task.objective}</strong>
              </p>
              <p>
                {task.path} · SHA-256:{" "}
                <span className="break-all">{task.sha256}</span>
              </p>
              <p>
                {t(
                  task.state === "criterion_matched"
                    ? "trackedTaskMatched"
                    : task.state === "cancelled"
                      ? "trackedTaskCancelled"
                      : "trackedTaskAwaiting",
                )}
              </p>
              {task.reason ? <p>{task.reason}</p> : null}
              {task.verifiedAt ? (
                <p>
                  {t("trackedTaskVerifiedAt")}{" "}
                  {new Date(task.verifiedAt).toLocaleString()}
                </p>
              ) : null}
              {task.state !== "cancelled" ? (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => void request("DELETE", { expectedRevision: task.revision })}
                >
                  {t("trackedTaskCancel")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {task ? <TaskContinuation sessionId={sessionId} ownerProof={ownerProof} task={task} disabled={continuationDisabled} onContinue={onContinue} onRefreshTask={() => void request("GET")} /> : null}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (task === undefined) return;
              void request("PUT", {
                task: { objective, path, sha256, continuationBudget: budget },
                expectedRevision: task?.revision ?? null,
              });
            }}
          >
            <label className="flex flex-col gap-1">
              {t("trackedTaskObjective")}
              <input
                className="min-h-11 rounded-md border bg-background px-2"
                required
                maxLength={500}
                value={objective}
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
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              {t("trackedTaskHash")}
              <input
                className="min-h-11 rounded-md border bg-background px-2"
                required
                pattern="[0-9a-fA-F]{64}"
                value={sha256}
                onChange={(e) => setSha256(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">{t("boundedContinuationBudget")}
              <select className="min-h-11 rounded-md border bg-background px-2" value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
                {[0, 1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <Button type="submit" size="sm" disabled={busy || task === undefined}>
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
            {t("permissionsRefresh")}
          </Button>
        </div>
      ) : null}
    </details>
  );
}
