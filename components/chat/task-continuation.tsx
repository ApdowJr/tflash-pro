"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
import { waitWithAbort } from "@/lib/abortable";
import type { TrackedTask } from "@/lib/tracked-task";

type Attempt = { attemptId: string; state: "reserved" | "dispatching"; createdAt: string; reviewRevision: string; holdNote: string | null; holdAt: string | null };
/** A manual, budgeted dispatch aid; not a scheduler or external-effect lock. */
export function TaskContinuation({ sessionId, ownerProof, task, disabled, onContinue, onRefreshTask }: {
  sessionId: string; ownerProof?: string; task: TrackedTask; disabled: boolean;
  onContinue: (attemptId: string) => Promise<void>; onRefreshTask: () => void;
}) {
  const { t } = useAppSettings();
  const [attempt, setAttempt] = useState<Attempt | null>();
  const [history, setHistory] = useState<{ attemptId: string; reviewedAt: string; note: string }[]>([]);
  const [busy, setBusy] = useState(false), [checked, setChecked] = useState(false), [error, setError] = useState(false), [note, setNote] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  const refreshVersion = useRef(0);
  const latest = useRef({ disabled, onContinue, onRefreshTask });
  latest.current = { disabled, onContinue, onRefreshTask };
  const url = `/api/chats/${encodeURIComponent(sessionId)}/task/continuations`;
  const send = useCallback(async (method: "GET" | "POST", signal: AbortSignal, body?: object) => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
    deadline.throwIfAborted();
    const request = fetch(url, { method, cache: "no-store", signal: deadline,
      headers: { ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    // If an implementation ignores abort, stop waiting and close a late body.
    void request.then(response => { if (deadline.aborted && response.body) void response.body.cancel().catch(() => {}); }, () => {});
    const r = await waitWithAbort(request, deadline);
    const result = await waitWithAbort(r.json(), deadline) as { attempt?: Attempt | null; history?: { attemptId: string; reviewedAt: string; note: string }[]; ok?: boolean };
    deadline.throwIfAborted();
    if (!r.ok || (method === "POST" && result.ok !== true)) throw new Error("Continuation state unconfirmed.");
    return result;
  }, [url, ownerProof]);
  const refresh = useCallback(async (signal: AbortSignal) => {
    const version = ++refreshVersion.current;
    let result: Awaited<ReturnType<typeof send>>;
    try { result = await send("GET", signal); }
    catch (error) { if (version !== refreshVersion.current && !signal.aborted) return; throw error; }
    if (version !== refreshVersion.current) return;
    if (result.attempt === undefined || (result.attempt !== null &&
      (typeof result.attempt.attemptId !== "string" || typeof result.attempt.reviewRevision !== "string" || typeof result.attempt.createdAt !== "string" || (result.attempt.holdNote !== null && typeof result.attempt.holdNote !== "string") || (result.attempt.holdAt !== null && typeof result.attempt.holdAt !== "string") || !["reserved", "dispatching"].includes(result.attempt.state)))) throw new Error("Invalid continuation state.");
    if (!Array.isArray(result.history) || result.history.length > 20 || result.history.some(item => typeof item.attemptId !== "string" || typeof item.reviewedAt !== "string" || typeof item.note !== "string")) throw new Error("Invalid continuation history.");
    signal.throwIfAborted(); if (version !== refreshVersion.current) return; setAttempt(result.attempt); setHistory(result.history);
  }, [send]);
  useEffect(() => {
    const controller = new AbortController();
    setAttempt(undefined); setHistory([]); setBusy(false); setError(false); setChecked(false); setNote("");
    void refresh(controller.signal).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { refreshVersion.current++; controller.abort(); pending.current?.abort(); pending.current = undefined; };
  }, [refresh]);
  async function run(action: "continue" | "hold" | "resolve" | "refresh") {
    if (pending.current || ((action === "continue" || action === "resolve") && (latest.current.disabled || !checked))) return;
    if ((action === "hold" || action === "resolve") && note.trim().length < 10) return;
    refreshVersion.current++;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(false);
    try {
      if (action === "continue") {
        if (attempt !== null || task.state !== "awaiting_evidence" || task.continuationBudget < 1) throw new Error("No available continuation.");
        const attemptId = crypto.randomUUID();
        await send("POST", controller.signal, { action: "reserve", attemptId, revision: task.revision });
        controller.signal.throwIfAborted();
        if (latest.current.disabled) throw new Error("Conversation is not ready.");
        await send("POST", controller.signal, { action: "begin", attemptId });
        controller.signal.throwIfAborted();
        if (latest.current.disabled) throw new Error("Conversation is not ready.");
        // No retry: even a lost response or rejected send requires review.
        await latest.current.onContinue(attemptId);
      } else if (action === "hold" || action === "resolve") {
        if (!attempt) throw new Error("No attempt to review.");
        await send("POST", controller.signal, { action, attemptId: attempt.attemptId, expectedRevision: attempt.reviewRevision, ...(action === "resolve" ? { reviewed: true } : {}), note: note.trim() });
      }
      controller.signal.throwIfAborted();
      await refresh(controller.signal);
      latest.current.onRefreshTask();
      setChecked(false); setNote("");
    } catch {
      if (!controller.signal.aborted) {
        setError(true); setChecked(false); setAttempt(undefined);
        // Fetching state is safe, but never resubmit an uncertain operation.
        try { await refresh(controller.signal); latest.current.onRefreshTask(); } catch { /* Explicit refresh remains available. */ }
      }
    } finally { if (pending.current === controller) { pending.current = undefined; setBusy(false); } }
  }
  return <section className="space-y-2 rounded-md border p-2" aria-label={t("boundedContinuationTitle")}>
    <strong>{t("boundedContinuationTitle")}</strong>
    <p>{t("boundedContinuationExplanation")}</p>
    <p>{t("boundedContinuationRemaining")} {task.continuationBudget}</p>
    {attempt ? <div role="status" className="space-y-1"><p>{t(attempt.state === "reserved" ? "boundedContinuationReserved" : "boundedContinuationDispatching")} <span className="break-all">{attempt.attemptId}</span></p><p>{t("boundedContinuationCreated")} {attempt.createdAt}</p>{attempt.holdNote ? <p>{t("boundedContinuationHeld")} {attempt.holdNote}</p> : null}</div> : null}
    {error ? <p role="alert" className="text-destructive">{t("boundedContinuationError")}</p> : null}
    {attempt !== undefined && (attempt || (task.state === "awaiting_evidence" && task.continuationBudget > 0)) ? <>
      {attempt ? <p>{t("boundedContinuationHoldHint")}</p> : null}
      {attempt ? <label className="flex flex-col gap-1">{t("boundedContinuationReviewNote")}<textarea className="min-h-20 rounded-md border bg-background p-2" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label> : null}
      {attempt ? <Button type="button" size="sm" variant="outline" disabled={busy || note.trim().length < 10} onClick={() => void run("hold")}>{t("boundedContinuationHold")}</Button> : null}
      <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />{t(attempt ? "boundedContinuationReviewed" : "boundedContinuationAuthorize")}</label>
      <Button type="button" size="sm" variant="outline" disabled={busy || disabled || !checked || (!!attempt && note.trim().length < 10)} onClick={() => void run(attempt ? "resolve" : "continue")}>{t(attempt ? "boundedContinuationResolve" : "boundedContinuationStart")}</Button>
    </> : null}
    {history.length ? <details><summary className="cursor-pointer">{t("boundedContinuationHistory")}</summary><ol className="space-y-2 pt-2">{history.map(item => <li key={item.attemptId} className="break-words"><span className="break-all">{item.attemptId}</span> · {item.reviewedAt}<p>{item.note}</p></li>)}</ol></details> : null}
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("refresh")}>{t("permissionsRefresh")}</Button>
  </section>;
}
