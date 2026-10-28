"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AgentMessage } from "./agent-message";

const DEFAULT_AGENT_NAME = "Tflash";

type ReadySession = { readonly id: string; readonly resume: boolean; readonly proof?: string };

/** Start sessions server-side so every login method receives a bound owner. */
export function AgentChat({ account, sessionId, sessionless = false }: {
  readonly account: Account;
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const { hydrated, eveHeaders, settings, registerChatProof } = useAppSettings();
  const [ready, setReady] = useState<ReadySession>();
  const [preparationError, setPreparationError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const createRef = useRef<Promise<{ id: string; proof?: string }> | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (sessionId) {
      const proof = settings.chatProofs[sessionId];
      if (account.kind === "vercel" && !proof) {
        setPreparationError("This conversation does not have a verifiable owner in this browser. Older chats are not imported automatically.");
        return;
      }
      setReady({ id: sessionId, resume: true, ...(proof ? { proof } : {}) });
      return;
    }
    let active = true;
    if (!createRef.current) {
      createRef.current = fetch("/api/chats", {
        method: "POST", headers: { ...eveHeaders(), "content-type": "application/json" }, body: "{}",
      }).then(async (response) => {
        const body = await response.json() as { sessionId?: string; ownerProof?: string; error?: string };
        if (!response.ok || !body.sessionId || (account.kind === "vercel" && !body.ownerProof)) {
          throw new Error(body.error || "Could not start a conversation.");
        }
        return { id: body.sessionId, ...(body.ownerProof ? { proof: body.ownerProof } : {}) };
      });
    }
    createRef.current.then(({ id, proof }) => {
      if (!active) return;
      if (proof) registerChatProof(id, proof);
      setReady({ id, resume: false, ...(proof ? { proof } : {}) });
      setPreparationError(undefined);
    }).catch((error: unknown) => {
      if (active) setPreparationError(error instanceof Error ? error.message : "Could not start a conversation.");
    });
    return () => { active = false; };
  }, [account.kind, sessionId, hydrated, attempt, eveHeaders, registerChatProof, settings.chatProofs]);

  const retry = () => {
    createRef.current = null;
    setPreparationError(undefined);
    setAttempt((value) => value + 1);
  };
  return (
    <PromptInputProvider>
      <ChatSession key={ready?.id ?? "preparing"} account={account} sessionId={ready?.id}
        resume={ready?.resume ?? false} ownerProof={ready?.proof} sessionless={sessionless}
        preparationError={preparationError} canRetry={!sessionId} onRetry={retry} />
    </PromptInputProvider>
  );
}

function ChatSession({ account, sessionId, resume, ownerProof, sessionless, preparationError, canRetry, onRetry }: {
  readonly account: Account;
  readonly sessionId?: string;
  readonly resume: boolean;
  readonly ownerProof?: string;
  readonly sessionless: boolean;
  readonly preparationError?: string;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
}) {
  const { t, settings, selection, eveHeaders, turnContext, recordChatActivity, oauthJustConnected } = useAppSettings();
  const controller = usePromptInputController();
  const [cancellationError, setCancellationError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "providers" | "connections" | "preferences"
  >("providers");
  const [settingsProvider, setSettingsProvider] = useState<string>();
  const [settingsInstance, setSettingsInstance] = useState(0);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasSubmittedMessage = useRef(false);

  const replaceSessionRoute = (nextSessionId: string) => {
    if (resume) return;
    History.prototype.replaceState.call(window.history, window.history.state, "", `/s/${encodeURIComponent(nextSessionId)}`);
  };

  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    headers: () => ({ ...eveHeaders(), ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}) }),
    prewarm: false,
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume,
    onSessionChange(session) {
      if (hasSubmittedMessage.current && session) replaceSessionRoute(session.sessionId);
    },
  });
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
  const turnFailure = isBusy || isResuming ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const hasConversationContent = sessionless || !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isResuming || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;
  const title = settings.chats.find((chat) => chat.id === activeSessionId)?.title ??
    sessionTitle(agent.data.messages, t("newChat"));
  const canRespond = (requestId: string) =>
    !isResuming && agent.data.inputs[requestId]?.status === "open";
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
    if (!oauthJustConnected) return;
    openSettings("connections");
  }, [oauthJustConnected, openSettings]);

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
    URL.revokeObjectURL(url);
  };

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(toErrorMessage(error));
    });
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isResuming || !sessionId) return;
    setCancellationError(undefined);
    const firstUser = agent.data.messages.find((entry) => entry.role === "user");
    const firstText = firstUser?.parts.find((part) => part.type === "text");
    const title = settings.chats.find((chat) => chat.id === sessionId)?.title ||
      (firstText?.type === "text" ? firstText.text : "") || text || t("attach");
    try {
      await recordChatActivity(sessionId, title);
    } catch (error) {
      setCancellationError(t("historySaveFailed"));
      throw error; // Keep the draft when history could not be saved.
    }
    hasSubmittedMessage.current = true;
    replaceSessionRoute(sessionId);
    const options = {
      clientContext: turnContext(),
      ...(isBusy ? { turnPolicy: "steer" as const } : {}),
    };

    if (message.files.length === 0) {
      await agent.send(text, options);
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send(parts, options);
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

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          canExport={!isEmpty}
          onExportChat={exportChat}
          onNewChat={startNewChat}
          onOpenModels={() => setModelsOpen(true)}
          onOpenSettings={() => openSettings("providers")}
          onOpenSidebar={() => setSidebarOpen(true)}
          title={showConversationLayout ? title : undefined}
        />

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
                      onInputResponses={(inputResponses) => {
                        setCancellationError(undefined);
                        return agent.respond(inputResponses, { clientContext: turnContext() });
                      }}
                      questionsFor={questionsFor}
                    />
                    {message.role === "assistant" ? (
                      <CopyMessageButton message={message} />
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

        <div className="tf-safe-bottom shrink-0 px-3 pt-1 sm:px-6">
          <div className="mx-auto w-full max-w-2xl">
            {preparationError ? (
              <div className="mb-3 rounded-md border border-destructive/30 px-3 py-2 text-destructive text-sm" role="alert">
                {preparationError}{canRetry ? <button className="ml-2 underline" onClick={onRetry} type="button">Retry</button> : null}
              </div>
            ) : !sessionId ? <p className="mb-2 text-muted-foreground text-xs" role="status">Preparing conversation…</p> : null}
            <ChatComposer
              isBusy={isBusy}
              isResuming={isResuming || !sessionId}
              onCancel={requestCancellation}
              onSubmit={handleSubmit}
            />
            <p className="mt-2 text-center text-[10.5px] text-muted-foreground/55">
              {t("disclaimer")}
            </p>
          </div>
        </div>
      </div>

      <ModelPicker
        onOpenChange={setModelsOpen}
        onOpenSettings={(providerId) => openSettings("providers", providerId)}
        open={modelsOpen}
      />
      <SettingsDialog
        // Open each request at the intended tab/provider, without stale inputs.
        initialTab={settingsTab}
        initialProvider={settingsProvider}
        key={settingsInstance}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
      />
    </div>
  );
}

function CopyMessageButton({
  message,
}: {
  readonly message: { parts: readonly { type: string; text?: string }[] };
}) {
  const { t } = useAppSettings();
  const [copied, setCopied] = useState(false);
  const hasText = message.parts.some((part) => part.type === "text" && part.text);
  if (!hasText) return null;
  return (
    <Button
      aria-label={t("copy")}
      className="tf-reveal absolute -bottom-5 left-0 h-6 gap-1 rounded-md bg-background/85 px-1.5 text-[10.5px] text-muted-foreground opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover/msg:opacity-100"
      onClick={() => {
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n\n");
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      {copied ? t("copied") : t("copy")}
    </Button>
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
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "turn.failed") {
      if (event.data.code === "MODEL_CALL_FAILED") {
        const detail = (event.data as { details?: { message?: string } }).details?.message;
        return detail
          ? `The model call failed — check Settings → Providers. ${detail}`
          : "The model call failed. Check your provider connection in Settings → Providers.";
      }
      return event.data.message;
    }

    if (event.type === "turn.completed" || event.type === "turn.cancelled") {
      return undefined;
    }

    if (event.type === "message.received") {
      return undefined;
    }
  }

  return undefined;
}
