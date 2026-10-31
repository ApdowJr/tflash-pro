"use client";

import { ChatActionUncertainError } from "@/lib/chat-action-recovery";
import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";
import { waitWithAbort } from "@/lib/abortable";
import { clearDispatchReview, clearReviewedDispatches, dispatchReviewKey, dispatchStorage, markDispatchReview, readDispatchReview } from "@/lib/dispatch-review";

import type { UserContent } from "ai";
import { Client } from "eve/client";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  type PromptInputMessage,
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";
import { ChatComposer } from "@/components/chat/chat-composer";
import { EmptyState } from "@/components/workspace/empty-state";
import { Sidebar, type Account } from "@/components/workspace/sidebar";
import { TopBar } from "@/components/workspace/top-bar";
import { ModelPicker } from "@/components/settings/model-picker";
import { useAppSettings } from "@/components/settings/app-settings";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { sessionTitle } from "@/lib/chat-history";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
import { AgentMessage, type AgentInputResponse } from "./agent-message";
import { InputResponseNotice, useInputResponseRecovery } from "./input-response-recovery";
import { StopRecoveryNotice, useStopRecovery } from "./stop-recovery";
import { SharedDispatchNotice, useSharedDispatchRecovery } from "./shared-dispatch-recovery";
import { isStopTurnId } from "@/lib/stop-recovery";
import { VoiceOutputButton } from "./voice-output";
import { AgentPlanCard, type AgentRunState } from "./agent-workspace";
import { PermissionsPanel } from "./permissions-panel";
import { TrackedTaskPanel } from "./tracked-task-panel";
import { UsagePanel } from "./usage-panel";
import { ProjectPicker } from "@/components/settings/workspace-panel";
import { useWorkspace } from "@/components/settings/workspace-store";
import { workspaceContext } from "@/lib/workspace";
import { attachedText } from "@/lib/documents/contracts";
import { HEADER_MAX_STEPS } from "@/lib/usage-limits";
import { latestAgentPlan } from "@/lib/agent-workspace";
import { latestTurn } from "@/lib/activity";
import { MAX_STREAM_RECONNECTS, streamReconnectDelay } from "@/lib/stream-recovery";
import { agentModeContext, agentModeStorageKey, parseAgentMode, type AgentMode } from "@/lib/agent-modes";

const DEFAULT_AGENT_NAME = "Tflash";

type ReadySession = { readonly id: string; readonly resume: boolean; readonly proof?: string };
type PreparationError = "chatStorageSetupRequired" | "chatStorageUnavailable" | "chatPreparationFailed" | "chatSignInRequired" | "chatOwnershipUnavailable" | "chatCreationUncertain" | "chatCreationStorageUnavailable";
type CreatedSession = { readonly id: string; readonly proof?: string; readonly marker: string };
class CreationNotStartedError extends Error {}

/** Start sessions server-side so every login method receives a bound owner. */
export function AgentChat({ account, sessionId, sessionless = false }: {
  readonly account: Account;
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const { hydrated, eveHeaders, settings, registerChatProof, t } = useAppSettings();
  const accountIdentity = JSON.stringify([account.kind, account.id]);
  const [readyState, setReadyState] = useState<{ source: string | undefined; account: string; value: ReadySession }>();
  const ready = readyState && readyState.source === sessionId && readyState.account === accountIdentity ? readyState.value : undefined;
  const [preparationError, setPreparationError] = useState<PreparationError>();
  const [reviewMarkers, setReviewMarkers] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const createRef = useRef<Promise<CreatedSession> | null>(null);
  const sourceIdentity = JSON.stringify([accountIdentity, sessionId ?? null]);
  const createSource = useRef(sourceIdentity);
  if (createSource.current !== sourceIdentity) {
    createSource.current = sourceIdentity;
    createRef.current = null;
  }

  useEffect(() => {
    if (!hydrated || ready) return;
    if (sessionId) {
      const proof = settings.chatProofs[sessionId];
      if (account.kind === "vercel" && !proof) {
        setPreparationError("chatOwnershipUnavailable");
        return;
      }
      setReadyState({ source: sessionId, account: accountIdentity, value: { id: sessionId, resume: true, ...(proof ? { proof } : {}) } });
      setPreparationError(undefined);
      return;
    }
    let active = true;
    if (!createRef.current) {
      let marker: string;
      try {
        const markers = syncUncertaintyMarkers("chat-create", account.kind, account.id);
        if (markers.length) {
          setReviewMarkers(markers);
          setPreparationError("chatCreationUncertain");
          return;
        }
        marker = beginSyncUncertainty("chat-create", account.kind, account.id);
      } catch {
        setPreparationError("chatCreationStorageUnavailable");
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 65_000);
      createRef.current = (async () => {
        const pending = fetch("/api/chats", {
          method: "POST", headers: { ...eveHeaders(), "content-type": "application/json", "x-tflash-expected-user-id": account.id, "x-tflash-expected-account-kind": account.kind }, body: "{}", signal: controller.signal,
        });
        void pending.then((response) => {
          if (controller.signal.aborted && response.body) void response.body.cancel().catch(() => {});
        }, () => {});
        const response = await waitWithAbort(pending, controller.signal);
        const input: unknown = await waitWithAbort(response.json(), controller.signal);
        const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
        if (!response.ok) {
          // These responses are emitted before Eve creation; a later storage
          // failure has the same code but does not carry this assertion.
          const notStarted = [401, 409, 415, 429].includes(response.status) || body.creationNotStarted === true;
          if (notStarted) {
            clearSyncUncertainty([marker]);
            const code = response.status === 401 ? "chatSignInRequired" : body.code === "CHAT_STORAGE_SETUP_REQUIRED" ? "chatStorageSetupRequired" : body.code === "CHAT_STORAGE_UNAVAILABLE" ? "chatStorageUnavailable" : "chatPreparationFailed";
            throw new CreationNotStartedError(code);
          }
          throw new Error("chatCreationUncertain");
        }
        const id = body.sessionId, proof = body.ownerProof;
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id) ||
          (account.kind === "vercel" && (typeof proof !== "string" || !proof || proof.length > 128))) {
          throw new Error("chatCreationUncertain");
        }
        return { id, marker, ...(typeof proof === "string" && proof.length <= 128 ? { proof } : {}) };
      })().finally(() => window.clearTimeout(timeout));
    }
    createRef.current.then(({ id, proof, marker }) => {
      if (!active) return;
      try {
        if (proof) registerChatProof(id, proof);
        clearSyncUncertainty([marker]);
        setReadyState({ source: sessionId, account: accountIdentity, value: { id, resume: false, ...(proof ? { proof } : {}) } });
        setPreparationError(undefined);
      } catch {
        setReviewMarkers([marker]);
        setPreparationError("chatCreationUncertain");
      }
    }).catch((error: unknown) => {
      if (!active) return;
      const code = error instanceof Error ? error.message : "";
      if (error instanceof CreationNotStartedError && (code === "chatStorageSetupRequired" || code === "chatStorageUnavailable" || code === "chatSignInRequired" || code === "chatPreparationFailed")) {
        setPreparationError(code);
        return;
      }
      try { setReviewMarkers(syncUncertaintyMarkers("chat-create", account.kind, account.id)); setPreparationError("chatCreationUncertain"); }
      catch { setPreparationError("chatCreationStorageUnavailable"); }
    });
    return () => { active = false; };
  }, [account.id, account.kind, accountIdentity, sessionId, hydrated, ready, attempt, eveHeaders, registerChatProof, settings.chatProofs]);

  const retry = () => {
    createRef.current = null;
    setPreparationError(undefined);
    setAttempt((value) => value + 1);
  };
  const reviewedRetry = () => {
    try {
      // Release only the markers the user actually saw, never newer ones.
      clearSyncUncertainty(reviewMarkers);
      const remaining = syncUncertaintyMarkers("chat-create", account.kind, account.id);
      if (remaining.length) { setReviewMarkers(remaining); return; }
      retry();
    } catch { setPreparationError("chatCreationStorageUnavailable"); }
  };
  return (
    <PromptInputProvider>
      <ChatSession key={JSON.stringify([accountIdentity, ready?.id ?? null])} account={account} sessionId={ready?.id}
        resume={ready?.resume ?? false} ownerProof={ready?.proof} sessionless={sessionless}
        preparationError={preparationError ? t(preparationError) : undefined} canRetry={!sessionId && preparationError !== "chatCreationUncertain"} onRetry={retry}
        creationReview={preparationError === "chatCreationUncertain"} onReviewedRetry={reviewedRetry} />
    </PromptInputProvider>
  );
}

function ChatSession({ account, sessionId, resume, ownerProof, sessionless, preparationError, canRetry, onRetry, creationReview, onReviewedRetry }: {
  readonly account: Account;
  readonly sessionId?: string;
  readonly resume: boolean;
  readonly ownerProof?: string;
  readonly sessionless: boolean;
  readonly preparationError?: string;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
  readonly creationReview: boolean;
  readonly onReviewedRetry: () => void;
}) {
  const { t, settings, selection, eveHeaders, turnContext, recordChatActivity, oauthJustConnected, oauthError } = useAppSettings();
  const [creationReviewed, setCreationReviewed] = useState(false);
  const controller = usePromptInputController();
  const workspace = useWorkspace();
  const [cancellationError, setCancellationError] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectPending = useRef(false);
  const cancellationPending = useRef(false);
  const cancellationRequestInFlight = useRef(false);
  const cancellationTarget = useRef<string | undefined>(undefined);
  const [cancellationRequestActive, setCancellationRequestActive] = useState(false);
  const cancellationEpoch = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "providers" | "connections" | "preferences"
  >("providers");
  const [settingsProvider, setSettingsProvider] = useState<string>();
  const [settingsInstance, setSettingsInstance] = useState(0);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>("chat");
  const [modeLoadedFor, setModeLoadedFor] = useState<string>();
  const hasSubmittedMessage = useRef(false);
  const submissionPending = useRef<symbol | undefined>(undefined);
  const dispatchInProgress = useRef(0);
  const dispatchError = useRef(false);
  // Invalidate any submission currently awaiting history persistence when a
  // concurrent send becomes uncertain, even before React renders the warning.
  const dispatchUncertaintyEpoch = useRef(0);
  const [dispatchStorageUnavailable, setDispatchStorageUnavailable] = useState(false);
  const [unknownDispatch, setUnknownDispatch] = useState(false);
  const unknownDispatchRef = useRef(false);
  const [dispatchReviewed, setDispatchReviewed] = useState(false);
  const reviewKey = sessionId ? dispatchReviewKey(account.kind, account.id, sessionId) : undefined;
  useEffect(() => {
    const pending = !!reviewKey && !!readDispatchReview(dispatchStorage(), reviewKey);
    unknownDispatchRef.current = pending;
    setUnknownDispatch(pending);
    setDispatchReviewed(false);
  }, [reviewKey]);

  useEffect(() => {
    if (!sessionId) return;
    const key = agentModeStorageKey(account.kind, account.id, sessionId);
    try { setAgentMode(parseAgentMode(window.localStorage.getItem(key))); }
    catch { setAgentMode("chat"); }
    setModeLoadedFor(sessionId);
  }, [account.id, account.kind, sessionId]);

  useEffect(() => {
    if (!sessionId || modeLoadedFor !== sessionId) return;
    try { window.localStorage.setItem(agentModeStorageKey(account.kind, account.id, sessionId), agentMode); }
    catch { /* Mode choice is optional; sending must still work if storage is blocked. */ }
  }, [account.id, account.kind, agentMode, modeLoadedFor, sessionId]);

  const replaceSessionRoute = (nextSessionId: string) => {
    if (resume) return;
    History.prototype.replaceState.call(window.history, window.history.state, "", `/s/${encodeURIComponent(nextSessionId)}`);
  };

  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    headers: () => ({ ...eveHeaders(), [HEADER_MAX_STEPS]: String(workspace.snapshot().maxSteps), ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}) }),
    prewarm: false,
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume,
    // Eve may resolve send() after reporting a transport error through this
    // callback. Do not mistake that resolution for a dispatch acknowledgement.
    onError() {
      if (dispatchInProgress.current > 0) {
        dispatchError.current = true;
        dispatchUncertaintyEpoch.current++;
        unknownDispatchRef.current = true;
        setUnknownDispatch(true);
        setDispatchReviewed(false);
      }
    },
    onSessionChange(session) {
      if (hasSubmittedMessage.current && session) replaceSessionRoute(session.sessionId);
    },
  });
  // Eve replaces the messages/events arrays when their contents change.
  // Reuse projections across unrelated UI updates without retaining a stale
  // review when a new transcript or turn event arrives.
  const currentPlan = useMemo(() => latestAgentPlan(agent.data.messages), [agent.data.messages]);
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";
  const isEmpty = agent.data.messages.length === 0;
  const lastMessage = agent.data.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking =
    isBusy &&
    (agent.status === "submitted" || lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const latest = useMemo(() => latestTurn(agent.events), [agent.events]);
  const turnFailure = isBusy || isResuming || latest?.outcome !== "failed" ? undefined : getLatestTurnFailure(agent.events, latest.turnId);
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const turnOutcome = latest?.outcome;
  const target = cancellationTarget.current;
  const targetStatus = target ? agent.data.turns?.[target]?.status : undefined;
  const targetSettled = !!target && (targetStatus === "completed" || targetStatus === "failed" || targetStatus === "cancelled" ||
    agent.events.some((event) => ["turn.completed", "turn.failed", "turn.cancelled"].includes(event.type) &&
      event.data && typeof event.data === "object" && "turnId" in event.data && event.data.turnId === target));
  const stopUnconfirmed = cancellationPending.current && !!target && !targetSettled;
  const disconnected = (agent.status === "error" && !(target && targetSettled && latest?.turnId === target) && (turnOutcome === "active" ||
    (turnOutcome === undefined && !!agent.data.activeTurnId && agent.data.turns?.[agent.data.activeTurnId]?.status === "active"))) ||
    (stopUnconfirmed && !isBusy && !isResuming);
  const resumeRef = useRef(agent.resume);
  resumeRef.current = agent.resume;
  const statusRef = useRef(agent.status); statusRef.current = agent.status;
  const translationRef = useRef(t); translationRef.current = t;
  const reconnect = useCallback((automatic: boolean) => {
    if (reconnectPending.current || cancellationRequestInFlight.current || (automatic && cancellationPending.current)) return;
    reconnectPending.current = true;
    setReconnecting(true);
    if (automatic) setReconnectAttempts((attempt) => attempt + 1);
    setCancellationError(undefined);
    // resume() only reattaches to the existing stream; it never sends a turn.
    // resume() may follow a live stream indefinitely. Bound only the UI wait;
    // timing out does not abort the stream or start a new turn.
    const signal = AbortSignal.timeout(15_000);
    void waitWithAbort(Promise.resolve().then(() => resumeRef.current()), signal).catch((error: unknown) => {
      if (signal.aborted) {
        // A healthy attached stream can keep resume() pending for the turn.
        if (statusRef.current !== "streaming") setCancellationError(translationRef.current("reconnectWaitExpired"));
      } else setCancellationError(toErrorMessage(error));
    }).finally(() => {
      reconnectPending.current = false;
      setReconnecting(false);
    });
  }, []);
  const projectedActiveTurn = agent.data.activeTurnId && agent.data.turns?.[agent.data.activeTurnId]?.status === "active" ? agent.data.activeTurnId : undefined;
  const recoveryTurn = projectedActiveTurn ?? (turnOutcome === "active" ? latest?.turnId : stopUnconfirmed ? target : undefined);
  const recoveryTurnRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // A short-lived reconnection is not a new budget: repeated disconnects in
    // the same turn remain bounded. A different turn starts a fresh allowance.
    if (recoveryTurnRef.current !== recoveryTurn) {
      recoveryTurnRef.current = recoveryTurn;
      setReconnectAttempts(0);
    }
  }, [recoveryTurn]);
  const retryDelay = useMemo(() => disconnected ? streamReconnectDelay(agent.error, reconnectAttempts) : undefined,
    [disconnected, agent.error, reconnectAttempts]);
  useEffect(() => {
    if (retryDelay === undefined || reconnecting || cancelling || cancellationPending.current) return;
    const timer = window.setTimeout(() => reconnect(true), retryDelay);
    return () => window.clearTimeout(timer);
  }, [retryDelay, reconnecting, cancelling, reconnect]);
  const openInputs = Object.values(agent.data.inputs).filter((input) => input.status === "open");
  const openInputsRef = useRef(openInputs); openInputsRef.current = openInputs;
  const hasOpenInput = openInputs.length > 0;
  const runState: AgentRunState = isResuming ? "resuming" : disconnected ? "interrupted" : errorMessage || agent.status === "error" ? "failed" :
    hasOpenInput ? "waiting" : isBusy ? "working" : turnOutcome === "cancelled" ? "cancelled" : "idle";

  useEffect(() => {
    // A transport reattachment is not a terminal turn boundary. Keep a
    // pending stop armed while cancellation or replay is still in flight.
    if (!isBusy && !disconnected && !isResuming && !reconnecting && !cancellationRequestInFlight.current) {
      cancellationPending.current = false; cancellationTarget.current = undefined; setCancelling(false);
    }
  }, [isBusy, disconnected, isResuming, reconnecting, cancellationRequestActive]);
  const hasConversationContent = sessionless || !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isResuming || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;
  const sharedDispatch = useSharedDispatchRecovery(account.kind, account.id, activeSessionId);
  const sharedBlocked = sharedDispatch.unavailable || sharedDispatch.warnings.length > 0;
  const stopRecovery = useStopRecovery(account.kind, account.id, activeSessionId, agent.events);
  const stopBlocked = stopRecovery.unavailable || stopRecovery.warnings.length > 0;
  const inputRecovery = useInputResponseRecovery(account.kind, account.id, activeSessionId, agent.events);
  const inputBlocked = inputRecovery.preparing || inputRecovery.warnings.length > 0 || (hasOpenInput && inputRecovery.unavailable);
  const openInputRef = useRef(hasOpenInput); openInputRef.current = hasOpenInput;
  const title = settings.chats.find((chat) => chat.id === activeSessionId)?.title ??
    sessionTitle(agent.data.messages, t("newChat"));

  // A browser tab in a long session should say which conversation it holds.
  // The title is user/provider text, so it is truncated and never interpreted.
  useEffect(() => {
    const base = `${DEFAULT_AGENT_NAME} — AI workspace`;
    if (!showConversationLayout || isEmpty || !title) {
      document.title = base;
      return;
    }
    const short = title.length > 72 ? `${title.slice(0, 71)}…` : title;
    document.title = `${short} · ${DEFAULT_AGENT_NAME}`;
  }, [isEmpty, showConversationLayout, title]);
  const baseCanRespond = (requestId: string) =>
    !isResuming && !disconnected && !cancelling && agent.data.inputs[requestId]?.status === "open";
  const baseCanRespondRef = useRef(baseCanRespond); baseCanRespondRef.current = baseCanRespond;
  const responseIdentity = JSON.stringify([account.kind, account.id, activeSessionId ?? null, ownerProof ?? null]);
  const responseIdentityRef = useRef(responseIdentity); responseIdentityRef.current = responseIdentity;
  const responseMounted = useRef(true);
  useEffect(() => { responseMounted.current = true; return () => { responseMounted.current = false; }; }, []);
  const canRespond = (requestId: string) => baseCanRespond(requestId) && !inputBlocked && !stopBlocked && !sharedBlocked;
  const respondToInput = async (responses: readonly AgentInputResponse[]) => {
    if (responses.length !== 1 || !baseCanRespondRef.current(responses[0].requestId) || inputRecovery.checkBlocked(true) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked()) throw new Error("Response requires review.");
    const marker = await inputRecovery.begin(responses[0].requestId);
    if (!responseMounted.current || responseIdentityRef.current !== responseIdentity || !baseCanRespondRef.current(responses[0].requestId) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked()) {
      inputRecovery.discard(marker); throw new Error("Conversation changed.");
    }
    setCancellationError(undefined);
    try {
      // respond() may keep the stream open for the turn's lifetime. Bound our
      // UI wait without aborting that stream or claiming the remote call stopped.
      const pending = Promise.resolve().then(() => {
        if (!responseMounted.current || responseIdentityRef.current !== responseIdentity || !baseCanRespondRef.current(responses[0].requestId) || !inputRecovery.isPresent(marker) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked()) {
          inputRecovery.discard(marker); throw new Error("Conversation changed.");
        }
        return agent.respond(responses, { clientContext: turnContext() + workspaceContext(workspace.snapshot(), sessionId) + agentModeContext(agentMode, settings.language) });
      });
      await waitWithAbort(pending, AbortSignal.timeout(30_000));
    } finally { inputRecovery.done(marker); }
  };
  const questionsFor = (callId: string) =>
    Object.values(agent.data.inputs).filter(
      (input) => input.request.kind === "question" && input.request.action.callId === callId,
    );

  const startNewChat = () => window.location.assign("/");

  const openSettings = useCallback(
    (tab: "providers" | "connections" | "preferences" = "providers", providerId?: string) => {
      setSettingsTab(tab);
      setSettingsProvider(providerId);
      setSettingsInstance((instance) => instance + 1);
      setSettingsOpen(true);
    },
    [],
  );

  // Coming back from a provider's consent screen lands on the chat route, so
  // reopen Connections to show the grant that was just approved.
  useEffect(() => {
    if (!oauthJustConnected && !oauthError) return;
    openSettings("connections");
  }, [oauthJustConnected, oauthError, openSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const overlayOpen = Boolean(document.querySelector(
        '[data-slot="dialog-content"][data-state="open"], [data-slot="dropdown-menu-content"][data-state="open"]',
      ));
      if (event.key === "Escape") {
        if (!overlayOpen) setSidebarOpen(false);
        return;
      }
      if (overlayOpen || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModelsOpen(true);
      } else if (event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        startNewChat();
      }
    };
    // Capture before a dialog handles Escape and changes its own open state.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const exportChat = () => {
    const markdown = [
      `# ${DEFAULT_AGENT_NAME}`,
      `> ${new Date().toISOString()} · ${selection.providerId}/${selection.modelId}`,
      "",
      ...agent.data.messages.map((message) => {
        const content = message.parts
          .filter((part) => part.type === "text")
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n\n")
          .trim();
        return `## ${message.role === "user" ? "You" : "Tflash"}\n\n${content}`;
      }),
    ].join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tflash-chat-${Date.now()}.md`;
    link.click();
    // Let the browser start the download before releasing the object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const requestStop = (requestedTurn?: string) => {
    if (cancellationPending.current || cancellationRequestInFlight.current) return;
    cancellationEpoch.current++;
    // Always use the observed exact turn when available. Eve's hook may use
    // unscoped session.cancel() after steering or resume; a delayed request
    // must not silently target a later turn.
    const turnId = activeSessionId && isStopTurnId(requestedTurn) ? requestedTurn : undefined;
    const marker = stopRecovery.begin(turnId);
    cancellationPending.current = true;
    cancellationRequestInFlight.current = true;
    cancellationTarget.current = turnId;
    setCancelling(true); setCancellationRequestActive(true); setCancellationError(undefined);
    const signal = AbortSignal.timeout(15_000);
    const operation = Promise.resolve().then(() => {
      if (!responseMounted.current || responseIdentityRef.current !== responseIdentity) throw new Error("Conversation changed.");
      return turnId && activeSessionId
      ? new Client({ host: WEB_CHAT_AGENT ? `/eve/${WEB_CHAT_AGENT}` : "", redirect: "error", headers: () => ({ ...eveHeaders(), [HEADER_MAX_STEPS]: String(workspace.snapshot().maxSteps), ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}) }) })
          .sessions.attach(activeSessionId).cancel({ turnId, signal })
      : agent.cancel();
    });
    let failed = false;
    void waitWithAbort(operation, signal).catch((error: unknown) => {
      failed = true;
      // Failure or timeout is not proof that the stop was rejected remotely.
      if (responseMounted.current && responseIdentityRef.current === responseIdentity) setCancellationError(toErrorMessage(error));
    }).finally(() => {
      if (!responseMounted.current || responseIdentityRef.current !== responseIdentity) return;
      cancellationRequestInFlight.current = false; setCancellationRequestActive(false);
      stopRecovery.done(marker);
      if (disconnected && !failed) reconnect(false);
    });
  };
  const requestCancellation = () => requestStop(
    projectedActiveTurn ?? (latest?.outcome === "active" ? latest.turnId : undefined),
  );
  const cancelDisconnectedTurn = () => { if (recoveryTurn && activeSessionId) requestStop(recoveryTurn); };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (text.length === 0 && message.files.length === 0) return;
    // A programmatic form submission must not clear a draft while the session
    // is unavailable, even though the visible Send button is disabled.
    if (isResuming || disconnected || !sessionId || cancellationPending.current || submissionPending.current || unknownDispatchRef.current || inputRecovery.checkBlocked(openInputRef.current) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked() ||
      (reviewKey && readDispatchReview(dispatchStorage(), reviewKey) && !(isBusy && dispatchInProgress.current > 0))) throw new Error("Conversation is not ready.");
    const preparation = Symbol("submission");
    submissionPending.current = preparation;
    let inputMarker: string | undefined, inputDispatched = false, inputWait: number | undefined;
    try {
      const sendEpoch = cancellationEpoch.current;
      const uncertaintyEpoch = dispatchUncertaintyEpoch.current;
      setCancellationError(undefined);
      const firstUser = agent.data.messages.find((entry) => entry.role === "user");
      const firstText = firstUser?.parts.find((part) => part.type === "text");
      const title = settings.chats.find((chat) => chat.id === sessionId)?.title ||
        (firstText?.type === "text" ? firstText.text : "") || text || t("attach");
      try {
        await recordChatActivity(sessionId, title);
      } catch (error) {
        setCancellationError(t(error instanceof ChatActionUncertainError ? "chatActionUncertain" : "historySaveFailed"));
        throw error; // Keep the draft when history could not be saved.
      }
      // A stop may arrive while the chat-index write is pending. Never schedule
      // the old submission after cancellation, even if the stream has settled.
      if (sendEpoch !== cancellationEpoch.current) throw new Error("Turn was stopped.");
      // Another in-flight send may have failed while this submission was
      // awaiting its index update. Do not steer or send after that uncertainty.
      if (!responseMounted.current || responseIdentityRef.current !== responseIdentity || uncertaintyEpoch !== dispatchUncertaintyEpoch.current || inputRecovery.checkBlocked(openInputRef.current) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked()) throw new Error("Dispatch outcome requires review.");
      hasSubmittedMessage.current = true;
      replaceSessionRoute(sessionId);
      const options = {
        clientContext: turnContext() + workspaceContext(workspace.snapshot(), sessionId) + agentModeContext(agentMode, settings.language),
        ...(isBusy ? { turnPolicy: "steer" as const } : {}),
      };

      const parts: UserContent = [];
      if (text.length > 0) {
        parts.push({ text, type: "text" });
      }
      for (const file of message.files) {
        const extracted = file.mediaType === "text/plain" || file.mediaType === "text/markdown" ? attachedText(file.url) : undefined;
        if (extracted !== undefined) {
          parts.push({ type: "text", text: `Untrusted attached text ${JSON.stringify(file.filename ?? "attachment")}:\n${extracted}` });
          continue;
        }
        parts.push({
          data: file.url,
          filename: file.filename,
          mediaType: file.mediaType,
          type: "file",
        });
      }

      // A plain message can answer Eve's first open prompt, including an
      // approval. Protect that path with the same breadcrumb as respond().
      const firstOpen = openInputsRef.current[0]?.request.requestId;
      if (firstOpen) {
        inputMarker = await inputRecovery.begin(firstOpen, "message");
        if (!responseMounted.current || responseIdentityRef.current !== responseIdentity || cancellationPending.current || sendEpoch !== cancellationEpoch.current ||
            openInputsRef.current[0]?.request.requestId !== firstOpen || !inputRecovery.isPresent(inputMarker) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked()) throw new Error("Input response requires review.");
      } else if (inputRecovery.checkBlocked(false) || stopRecovery.checkBlocked() || sharedDispatch.checkBlocked()) throw new Error("Input response requires review.");

      // The marker is a recovery hint for this tab, not an Eve idempotency key.
      // It is written before dispatch so a reload after a lost response does not
      // silently invite a retry. Storage can be unavailable; then the in-memory
      // guard still applies for this tab's lifetime.
      const token = crypto.randomUUID();
      const sharedMarker = sharedDispatch.begin();
      if (reviewKey && !markDispatchReview(dispatchStorage(), reviewKey, token)) setDispatchStorageUnavailable(true);
      if (dispatchInProgress.current === 0) dispatchError.current = false;
      dispatchInProgress.current++;
      if (submissionPending.current === preparation) submissionPending.current = undefined;
      let cleanDispatch = false;
      try {
        if (inputMarker) { inputDispatched = true; const key = inputMarker; inputWait = window.setTimeout(() => inputRecovery.done(key), 30_000); }
        await agent.send(message.files.length === 0 ? text : parts, options);
        if (!responseMounted.current || responseIdentityRef.current !== responseIdentity || dispatchError.current || sendEpoch !== cancellationEpoch.current) throw new Error("Dispatch outcome requires review.");
        if (reviewKey) {
          clearDispatchReview(dispatchStorage(), reviewKey, token);
          // Other in-flight sends (for example, an explicit steer) keep their
          // own marker. If ours remains, fail closed rather than losing it.
          const remaining = readDispatchReview(dispatchStorage(), reviewKey);
          if (remaining && remaining.includes(token)) throw new Error("Dispatch review could not be cleared.");
        }
        cleanDispatch = true;
      } catch (error) {
        dispatchUncertaintyEpoch.current++;
        unknownDispatchRef.current = true;
        if (responseMounted.current && responseIdentityRef.current === responseIdentity) { setUnknownDispatch(true); setDispatchReviewed(false); }
        throw error;
      } finally { dispatchInProgress.current--; sharedDispatch.finish(sharedMarker, cleanDispatch); }
    } finally {
      if (inputWait !== undefined) window.clearTimeout(inputWait);
      if (inputMarker) { if (inputDispatched) inputRecovery.done(inputMarker); else inputRecovery.discard(inputMarker); }
      if (submissionPending.current === preparation) submissionPending.current = undefined;
    }
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar
        account={account}
        activeChatId={activeSessionId}
        onClose={() => setSidebarOpen(false)}
        onNewChat={startNewChat}
        onOpenSettings={() => openSettings("providers")}
        open={sidebarOpen}
      />

      <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        <TopBar
          canExport={!isEmpty}
          onExportChat={exportChat}
          onNewChat={startNewChat}
          onOpenModels={() => setModelsOpen(true)}
          onOpenSettings={() => openSettings("providers")}
          onOpenSidebar={() => setSidebarOpen(true)}
          sidebarOpen={sidebarOpen}
          title={showConversationLayout ? title : undefined}
        />

        <details className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground sm:px-6">
          <summary className="w-fit cursor-pointer font-medium hover:text-foreground">{t("approvalModeStatus")}</summary>
          <p className="mt-2 max-w-2xl leading-relaxed">{t("approvalModeDetails")}</p>
        </details>
        {disconnected ? <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground" role="status">
          <span className="min-w-0 flex-1">{t("reconnectHint")}</span>
          {(!cancelling && retryDelay !== undefined) || reconnecting ? <span>{t("reconnectAutomatic")}</span> :
            reconnectAttempts >= MAX_STREAM_RECONNECTS ? <span>{t("reconnectExhausted")}</span> : null}
          <Button type="button" size="sm" variant="outline" disabled={reconnecting || cancellationRequestActive} onClick={() => reconnect(false)}>{t("reconnect")}</Button>
          {recoveryTurn ? <Button type="button" size="sm" variant="outline" disabled={cancelling} onClick={cancelDisconnectedTurn}>{t(cancelling ? "cancelling" : "stopDisconnectedTurn")}</Button> : null}
        </div> : null}
        {dispatchStorageUnavailable ? <p role="status" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-muted-foreground sm:px-6">{t("dispatchStorageUnavailable")}</p> : null}
        {unknownDispatch ? <section className="mx-auto w-full max-w-2xl space-y-2 px-4 py-2 text-xs text-muted-foreground" role="alert">
          <p>{t("dispatchUnknown")}</p>
          <ol className="list-decimal space-y-1 pl-5"><li>{t("dispatchReconnectStep")}</li><li>{t("dispatchExternalStep")}</li><li>{t("dispatchNoReplayStep")}</li></ol>
          {!disconnected ? <Button type="button" size="sm" variant="outline" disabled={isBusy || isResuming || reconnecting || cancellationRequestActive} onClick={() => reconnect(false)}>{t("reconnect")}</Button> : null}
          <label className="flex items-start gap-2"><input type="checkbox" checked={dispatchReviewed} onChange={(event) => setDispatchReviewed(event.target.checked)} />{t("dispatchReviewed")}</label>
          <Button type="button" size="sm" variant="outline" disabled={!dispatchReviewed || disconnected || isBusy || isResuming || reconnecting || cancelling || dispatchInProgress.current > 0} onClick={() => {
            if (dispatchInProgress.current > 0) return;
            if (reviewKey) clearReviewedDispatches(dispatchStorage(), reviewKey);
            const pending = !!reviewKey && !!readDispatchReview(dispatchStorage(), reviewKey);
            unknownDispatchRef.current = pending;
            setUnknownDispatch(pending); setDispatchReviewed(false);
          }}>{t("dispatchUnlock")}</Button>
        </section> : null}
        {sharedDispatch.unavailable ? <p role="alert" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-destructive">{t("sharedDispatchReadUnavailable")}</p> : null}
        {sharedDispatch.writeFailed ? <p role="status" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-muted-foreground">{t("sharedDispatchStorageUnavailable")}</p> : null}
        {sharedDispatch.warnings.length > 0 && !unknownDispatch && !disconnected && stopRecovery.warnings.length === 0 ? <div className="mx-auto w-full max-w-2xl px-3"><Button type="button" size="sm" variant="outline" disabled={isBusy || isResuming || reconnecting || cancellationRequestActive} onClick={() => reconnect(false)}>{t("reconnect")}</Button></div> : null}
        {sharedDispatch.warnings.map(warning => <SharedDispatchNotice key={warning.key} warning={warning} review={sharedDispatch.review} />)}
        {stopRecovery.unavailable ? <p role="alert" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-destructive">{t("stopRecoveryReadUnavailable")}</p> : null}
        {stopRecovery.warnings.length > 0 && !disconnected ? <div className="mx-auto w-full max-w-2xl px-3"><Button type="button" size="sm" variant="outline" disabled={isBusy || isResuming || reconnecting || cancellationRequestActive} onClick={() => reconnect(false)}>{t("reconnect")}</Button></div> : null}
        {stopRecovery.warnings.map(warning => <StopRecoveryNotice key={warning.key} warning={warning} busy={stopRecovery.active.includes(warning.key)} review={(key) => {
          const reviewed = stopRecovery.review(key);
          if (reviewed && stopRecovery.active.length === 0) { cancellationPending.current = false; cancellationTarget.current = undefined; setCancelling(false); }
          return reviewed;
        }} />)}
        {hasOpenInput && !inputBlocked && !stopBlocked && !sharedBlocked ? <p role="status" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-muted-foreground">{t("inputResponseChatHint")}</p> : null}
        {inputRecovery.unavailable && hasOpenInput ? <p role="alert" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-destructive">{t("inputResponseStorageUnavailable")}</p> : null}
        {inputRecovery.warnings.map(warning => <InputResponseNotice key={warning.key} warning={warning} busy={inputRecovery.active.includes(warning.key) || inputRecovery.preparing} review={inputRecovery.review} />)}
        {runState === "cancelled" ? <p role="status" className="mx-auto w-full max-w-2xl px-4 py-2 text-xs text-muted-foreground sm:px-6">{t("turnStoppedHint")}</p> : null}
        {currentPlan ? <div className="shrink-0 px-4 py-2 sm:px-6"><AgentPlanCard compact plan={currentPlan} runState={unknownDispatch || inputBlocked || stopBlocked || sharedBlocked ? "interrupted" : runState} onContinue={() => handleSubmit({ text: t("continueTaskPrompt"), files: [] })} /></div> : null}

        {showConversationLayout ? (
          <Conversation
            className="min-h-0 flex-1"
            initial={resume ? false : undefined}
            resize={activeSessionId === undefined ? "smooth" : "instant"}
            scrollRestorationKey={
              isEmpty || activeSessionId === undefined
                ? undefined
                : `tflash:chat-scroll:${activeSessionId}`
            }
          >
            <ConversationContent className="tflash-scroll mx-auto w-full max-w-2xl gap-6 px-4 pt-4 pb-8 sm:gap-7 sm:px-6">
              {agent.data.messages.map((message, index) =>
                showPendingThinking &&
                isPendingAssistantShell &&
                message.id === lastMessage.id ? null : (
                  <div className="group/msg relative" key={message.id}>
                    <AgentMessage
                      canRespond={canRespond}
                      isStreaming={
                        agent.status === "streaming" && index === agent.data.messages.length - 1
                      }
                      message={message}
                      onInputResponses={respondToInput}
                      questionsFor={questionsFor}
                    />
                    {message.role === "assistant" ? (
                      <MessageActions
                        isStreaming={isBusy && index === agent.data.messages.length - 1}
                        message={message}
                      />
                    ) : null}
                  </div>
                ),
              )}
              {isResuming && agent.data.messages.length === 0 ? <ResumingState /> : null}
              {showPendingThinking ? <PendingThinking /> : null}
              {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        ) : (
          <div className="tflash-scroll min-h-0 flex-1 overflow-y-auto">
            <EmptyState />
          </div>
        )}

        <div className="tf-safe-bottom tf-chat-dock shrink-0 pt-1">
          <div className="mx-auto w-full max-w-2xl">
            {preparationError ? (
              <div className="mb-3 rounded-md border border-destructive/30 px-3 py-2 text-destructive text-sm" role="alert">
                {preparationError}{canRetry ? <button className="ml-2 min-h-11 rounded px-1 underline focus-visible:outline focus-visible:outline-2" onClick={onRetry} type="button">{t("retry")}</button> : null}
                {creationReview ? <div className="mt-2 space-y-2 text-foreground">
                  <label className="flex items-start gap-2"><input type="checkbox" checked={creationReviewed} onChange={(event) => setCreationReviewed(event.target.checked)} />{t("chatCreationReviewLabel")}</label>
                  <Button disabled={!creationReviewed} onClick={() => { setCreationReviewed(false); onReviewedRetry(); }} type="button" size="sm" variant="outline">{t("chatCreationReviewButton")}</Button>
                </div> : null}
              </div>
            ) : !sessionId ? <p className="mb-2 text-muted-foreground text-xs" role="status">{t("chatPreparing")}</p> : null}
            <ProjectPicker sessionId={sessionId} disabled={isBusy || isResuming} />
            <ChatComposer
              mode={agentMode}
              onModeChange={setAgentMode}
              isBusy={isBusy}
              isResuming={isResuming || disconnected || unknownDispatch || inputBlocked || stopBlocked || sharedBlocked || !sessionId}
              cancelling={cancelling}
              onCancel={requestCancellation}
              onSubmit={handleSubmit}
            />
            <p className="mt-2 text-center text-[10.5px] text-muted-foreground/55">
              {t("disclaimer")}
            </p>
          </div>
        </div>
      </main>

      <ModelPicker
        onOpenChange={setModelsOpen}
        onOpenSettings={(providerId) => openSettings("providers", providerId)}
        open={modelsOpen}
      />
      <SettingsDialog
        // Open each request at the intended tab/provider, without stale inputs.
        initialTab={settingsTab}
        initialProvider={settingsProvider}
        conversationControls={sessionId ? <div className="space-y-2" key={sessionId}>
          <UsagePanel events={agent.events} />
          <PermissionsPanel sessionId={sessionId} ownerProof={ownerProof} />
          <TrackedTaskPanel sessionId={sessionId} ownerProof={ownerProof} continuationDisabled={isBusy || isResuming || disconnected || cancelling || unknownDispatch || inputBlocked || stopBlocked || sharedBlocked} onContinue={(attemptId) => handleSubmit({ text: `${t("continueTaskPrompt")}\n\nTracked continuation attempt: ${attemptId}. This label is not proof of execution or an idempotency key.`, files: [] })} />
        </div> : null}
        key={settingsInstance}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
      />
    </div>
  );
}

function MessageActions({
  message,
  isStreaming,
}: {
  readonly message: { parts: readonly { type: string; text?: string }[] };
  readonly isStreaming: boolean;
}) {
  // Do not include reasoning, attachments, tool arguments or tool output.
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n\n");
  if (!text.trim()) return null;
  return (
    <div className="tf-reveal mt-1 flex w-fit items-center gap-1 rounded-md bg-background/85 opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
      <CopyMessageButton text={text} />
      <VoiceOutputButton disabled={isStreaming} text={text} />
    </div>
  );
}

function CopyMessageButton({ text }: { readonly text: string }) {
  const { t } = useAppSettings();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch { setStatus("failed"); }
  }
  return (
    <>
      <Button
        aria-label={t("copy")}
        className="tf-touch-target h-8 gap-1 rounded-md px-2 text-xs text-muted-foreground"
        onClick={() => void copy()}
        size="sm"
        type="button"
        variant="ghost"
      >
        {status === "copied" ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        {t("copy")}
      </Button>
      <span className="text-xs text-muted-foreground" role="status">{status === "failed" ? t("copyFailed") : status === "copied" ? t("copied") : ""}</span>
    </>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  const { t } = useAppSettings();
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-[13px]"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-foreground">{t("requestFailed")}</p>
            <p className="mt-0.5 text-pretty text-muted-foreground leading-relaxed">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function ResumingState() {
  const { t } = useAppSettings();
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-brand" />
      {t("loadingChat")}
    </p>
  );
}

function PendingThinking() {
  const { t } = useAppSettings();
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="flex w-full items-center gap-2 text-muted-foreground text-sm">
          <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-brand" />
          <Shimmer duration={1}>{t("thinking")}</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to cancel the response.";
}

function getLatestTurnFailure(
  events: ReturnType<typeof useEveAgent>["events"],
  turnId: string,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "turn.failed" && event.data.turnId === turnId) {
      if (event.data.code === "MODEL_CALL_FAILED") {
        const detail = (event.data as { details?: { message?: string } }).details?.message;
        return detail
          ? `The model call failed — check Settings → Providers. ${detail}`
          : "The model call failed. Check your provider connection in Settings → Providers.";
      }
      return event.data.message;
    }

  }

  return undefined;
}
