"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/settings/app-settings";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
import { fetchCatalogResponse, readCatalogJson } from "@/lib/catalog-fetch";
import type { TrackedTask } from "@/lib/tracked-task";
import { parseContinuationSnapshot, type ContinuationAttempt, type ContinuationHistoryEntry } from "@/lib/continuation-snapshot";
import { ControlRecoveryNotice, useControlRecovery } from "@/components/chat/control-recovery";

class ContinuationNotStarted extends Error {}
/** A manual, budgeted dispatch aid; not a scheduler or external-effect lock. */
export function TaskContinuation({ sessionId, ownerProof, task, disabled, onContinue, onRefreshTask }: {
  sessionId: string; ownerProof?: string; task: TrackedTask; disabled: boolean;
  onContinue: (attemptId: string) => Promise<void>; onRefreshTask: () => void;
}) {
  const { t, accountId, accountKind } = useAppSettings();
  const [attempt, setAttempt] = useState<ContinuationAttempt | null>();
  const [history, setHistory] = useState<ContinuationHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false), [checked, setChecked] = useState(false), [error, setError] = useState(false), [note, setNote] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  const refreshVersion = useRef(0);
  const identity = JSON.stringify([accountKind, accountId, sessionId, ownerProof ?? null]);
  const [stateIdentity, setStateIdentity] = useState(identity);
  const sameScope = stateIdentity === identity;
  const recovery = useControlRecovery("control-continuation", sessionId);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const latest = useRef({ disabled, onContinue, onRefreshTask });
  latest.current = { disabled, onContinue, onRefreshTask };
  const url = `/api/chats/${encodeURIComponent(sessionId)}/task/continuations`;
  const send = useCallback(async (method: "GET" | "POST", signal: AbortSignal, body?: object) => {
    const { response: r, signal: deadline } = await fetchCatalogResponse(url, { method, cache: "no-store", signal,
      headers: { "x-tflash-expected-user-id": accountId, "x-tflash-expected-account-kind": accountKind,
        ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }, 8_000);
    if (!r.ok) {
      if (method === "POST" && [400, 403, 404, 409, 413, 415].includes(r.status)) {
        try {
          const rejection = await readCatalogJson(r, deadline, 16 * 1024);
          if (rejection && typeof rejection === "object" && !Array.isArray(rejection) && (rejection as { continuationNotStarted?: unknown }).continuationNotStarted === true) throw new ContinuationNotStarted();
        } catch (error) { if (error instanceof ContinuationNotStarted) throw error; }
      } else if (r.body) void r.body.cancel().catch(() => {});
      throw new Error("Continuation state unconfirmed.");
    }
    const result = await readCatalogJson(r, deadline, 128 * 1024) as { ok?: unknown };
    deadline.throwIfAborted();
    if (currentIdentity.current !== identity) throw new Error("Account changed.");
    if (!result || typeof result !== "object" || Array.isArray(result) || (method === "POST" && result.ok !== true)) throw new Error("Continuation state unconfirmed.");
    return result;
  }, [url, ownerProof, accountId, accountKind, identity]);
  const refresh = useCallback(async (signal: AbortSignal) => {
    const version = ++refreshVersion.current;
    let result: Awaited<ReturnType<typeof send>>;
    try { result = await send("GET", signal); }
    catch (error) { if (version !== refreshVersion.current && !signal.aborted) return; throw error; }
    if (version !== refreshVersion.current) return;
    const snapshot = parseContinuationSnapshot(result);
    if (!snapshot) throw new Error("Invalid continuation state.");
    signal.throwIfAborted(); if (version !== refreshVersion.current || currentIdentity.current !== identity) return; setAttempt(snapshot.attempt); setHistory(snapshot.history);
  }, [send, identity]);
  useEffect(() => {
    const controller = new AbortController();
    setStateIdentity(identity); setAttempt(undefined); setHistory([]); setBusy(false); setError(false); setChecked(false); setNote("");
    void refresh(controller.signal).catch(() => { if (!controller.signal.aborted && currentIdentity.current === identity) setError(true); });
    return () => { refreshVersion.current++; controller.abort(); pending.current?.abort(); pending.current = undefined; };
  }, [refresh]);
  async function run(action: "continue" | "hold" | "resolve" | "refresh") {
    if (!sameScope || pending.current || ((action === "continue" || action === "resolve") && (latest.current.disabled || !checked || recovery.unavailable || recovery.warnings.length > 0))) return;
    if ((action === "hold" || action === "resolve") && note.trim().length < 10) return;
    refreshVersion.current++;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(false);
    const stillCurrent = () => pending.current === controller && !controller.signal.aborted && currentIdentity.current === identity;
    const checkCurrent = () => { controller.signal.throwIfAborted(); if (!stillCurrent()) throw new Error("Account changed."); };
    const mutate = async (kind: "reserve" | "begin" | "hold" | "resolve", body: object) => {
      let marker: string | undefined;
      try { marker = recovery.begin(kind, kind === "hold"); }
      catch (error) { if (kind !== "hold") throw error; }
      try {
        await send("POST", controller.signal, body);
        checkCurrent();
        if (marker) recovery.finish(marker);
      } catch (error) {
        if (marker && error instanceof ContinuationNotStarted && stillCurrent()) recovery.finish(marker);
        if (stillCurrent()) recovery.refresh();
        throw error;
      }
    };
    try {
      if (action === "continue") {
        if (attempt !== null || task.state !== "awaiting_evidence" || task.continuationBudget < 1) throw new Error("No available continuation.");
        const attemptId = crypto.randomUUID();
        await mutate("reserve", { action: "reserve", attemptId, revision: task.revision });
        checkCurrent();
        if (latest.current.disabled) throw new Error("Conversation is not ready.");
        await mutate("begin", { action: "begin", attemptId });
        checkCurrent();
        if (latest.current.disabled) throw new Error("Conversation is not ready.");
        // No retry: even a lost response or rejected send requires review.
        await latest.current.onContinue(attemptId);
      } else if (action === "hold" || action === "resolve") {
        if (!attempt) throw new Error("No attempt to review.");
        await mutate(action, { action, attemptId: attempt.attemptId, expectedRevision: attempt.reviewRevision, ...(action === "resolve" ? { reviewed: true } : {}), note: note.trim() });
      }
      checkCurrent();
      await refresh(controller.signal);
      checkCurrent(); latest.current.onRefreshTask();
      setChecked(false); setNote("");
    } catch {
      if (stillCurrent()) {
        setError(true); setChecked(false); setAttempt(undefined);
        // Fetching state is safe, but never resubmit an uncertain operation.
        try { await refresh(controller.signal); if (stillCurrent()) latest.current.onRefreshTask(); } catch { /* Explicit refresh remains available. */ }
      }
    } finally { if (stillCurrent()) { pending.current = undefined; setBusy(false); } }
  }
  const visibleAttempt = sameScope ? attempt : undefined;
  const visibleHistory = sameScope ? history : [];
  const blocked = !sameScope || recovery.unavailable || recovery.warnings.length > 0;
  return <section className="space-y-2 rounded-md border p-2" aria-label={t("boundedContinuationTitle")}>
    <strong>{t("boundedContinuationTitle")}</strong>
    <p>{t("boundedContinuationExplanation")}</p>
    <p>{t("boundedContinuationRemaining")} {task.continuationBudget}</p>
    {recovery.unavailable ? <p role="alert" className="text-destructive">{t("continuationStorageUnavailable")}</p> : null}
    {recovery.warnings.map(warning => <ControlRecoveryNotice key={warning.key} warning={warning} review={recovery.review} busy={busy || !sameScope} />)}
    {visibleAttempt ? <div role="status" className="space-y-1"><p>{t(visibleAttempt.state === "reserved" ? "boundedContinuationReserved" : "boundedContinuationDispatching")} <span className="break-all">{visibleAttempt.attemptId}</span></p><p>{t("boundedContinuationCreated")} {visibleAttempt.createdAt}</p>{visibleAttempt.holdNote ? <p>{t("boundedContinuationHeld")} {visibleAttempt.holdNote}</p> : null}</div> : null}
    {sameScope && error ? <p role="alert" className="text-destructive">{t("boundedContinuationError")}</p> : null}
    {visibleAttempt !== undefined && (visibleAttempt || (task.state === "awaiting_evidence" && task.continuationBudget > 0)) ? <>
      {visibleAttempt ? <p>{t("boundedContinuationHoldHint")}</p> : null}
      {visibleAttempt ? <label className="flex flex-col gap-1">{t("boundedContinuationReviewNote")}<textarea className="min-h-20 rounded-md border bg-background p-2" maxLength={1000} value={sameScope ? note : ""} onChange={e => setNote(e.target.value)} /></label> : null}
      {visibleAttempt ? <Button type="button" size="sm" variant="outline" disabled={busy || note.trim().length < 10} onClick={() => void run("hold")}>{t("boundedContinuationHold")}</Button> : null}
      <label className="flex items-start gap-2"><input type="checkbox" checked={sameScope && checked} onChange={e => setChecked(e.target.checked)} />{t(visibleAttempt ? "boundedContinuationReviewed" : "boundedContinuationAuthorize")}</label>
      <Button type="button" size="sm" variant="outline" disabled={busy || disabled || blocked || !checked || (!!visibleAttempt && note.trim().length < 10)} onClick={() => void run(visibleAttempt ? "resolve" : "continue")}>{t(visibleAttempt ? "boundedContinuationResolve" : "boundedContinuationStart")}</Button>
    </> : null}
    {visibleHistory.length ? <details><summary className="cursor-pointer">{t("boundedContinuationHistory")}</summary><ol className="space-y-2 pt-2">{visibleHistory.map(item => <li key={item.attemptId} className="break-words"><span className="break-all">{item.attemptId}</span> · {item.reviewedAt}<p>{item.note}</p></li>)}</ol></details> : null}
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("refresh")}>{t("continuationRefresh")}</Button>
  </section>;
}
