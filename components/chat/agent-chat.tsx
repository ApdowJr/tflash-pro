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
import { AgentMessage } from "./agent-message";

const DEFAULT_AGENT_NAME = "t-flash";

export function AgentChat({
  account,
  sessionId,
  sessionless = false,
}: {
  readonly account?: Account;
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  return (
    <PromptInputProvider>
      <ChatSession account={account} sessionId={sessionId} sessionless={sessionless} />
    </PromptInputProvider>
  );
}

function ChatSession({
  account,
  sessionId,
  sessionless,
}: {
  readonly account?: Account;
  readonly sessionId?: string;
  readonly sessionless: boolean;
}) {
  const { t, selection, eveHeaders, turnContext, addChat, oauthJustConnected } = useAppSettings();
  const controller = usePromptInputController();
  const [cancellationError, setCancellationError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "providers" | "connections" | "models" | "preferences"
  >("providers");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasSubmittedMessage = useRef(false);
  const pendingTitle = useRef("");

  const replaceSessionRoute = (nextSessionId: string) => {
    if (sessionId !== undefined) return;
    // Framework routers patch window.history; navigating through them would
    // remount this route and detach the active stream.
    History.prototype.replaceState.call(
      window.history,
      window.history.state,
      "",
      `/s/${encodeURIComponent(nextSessionId)}`,
    );
  };

  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    headers: eveHeaders,
    prewarm: controller.textInput.value.trim().length > 0,
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (hasSubmittedMessage.current && session !== undefined) {
        replaceSessionRoute(session.sessionId);
        addChat(session.sessionId, pendingTitle.current || t("unnamedChat"));
      }
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
  const title = sessionTitle(agent.data.messages, t("newChat"));
  const canRespond = (requestId: string) =>
    !isResuming && agent.data.inputs[requestId]?.status === "open";
  const questionsFor = (callId: string) =>
    Object.values(agent.data.inputs).filter(
      (input) => input.request.kind === "question" && input.request.action.callId === callId,
    );

  // Keep the local chat list useful for resumed sessions too.
  useEffect(() => {
    const id = sessionId ?? agent.session?.sessionId;
    if (!id) return;
    const firstUser = agent.data.messages.find((message) => message.role === "user");
    const firstText = firstUser?.parts.find((part) => part.type === "text");
    if (firstText?.type === "text" && firstText.text) {
      addChat(id, firstText.text.slice(0, 80));
    }
    // Only re-run when the session or message count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, agent.session?.sessionId, agent.data.messages.length, addChat]);

  const startNewChat = () => {
    setSidebarOpen(false);
    if (sessionId !== undefined) {
      window.location.assign("/");
      return;
    }
    agent.reset();
    History.prototype.replaceState.call(window.history, window.history.state, "", "/");
    setCancellationError(undefined);
  };

  const openSettings = useCallback(
    (tab: "providers" | "connections" | "models" | "preferences" = "providers") => {
      setSettingsTab(tab);
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
      if (event.key === "Escape") {
        setSidebarOpen(false);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModelsOpen(true);
      } else if (event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
        return `## ${message.role === "user" ? "You" : "T Flash"}\n\n${content}`;
      }),
    ].join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `t-flash-chat-${Date.now()}.md`;
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
    if ((text.length === 0 && message.files.length === 0) || isResuming) return;

    setCancellationError(undefined);
    hasSubmittedMessage.current = true;
    pendingTitle.current = text.slice(0, 80) || t("attach");
    if (agent.session !== undefined) {
      replaceSessionRoute(agent.session.sessionId);
      addChat(agent.session.sessionId, pendingTitle.current);
    }
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
        onOpenConnections={() => openSettings("connections")}
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
            initial={sessionId === undefined ? undefined : false}
            resize={activeSessionId === undefined ? "smooth" : "instant"}
            scrollRestorationKey={
              isEmpty || activeSessionId === undefined
                ? undefined
                : `tflash:chat-scroll:${activeSessionId}`
            }
          >
            <ConversationContent className="tflash-scroll mx-auto w-full max-w-2xl gap-7 px-5 pt-4 pb-8 sm:px-6">
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
            <EmptyState
              onOpenConnections={() => openSettings("connections")}
              onOpenSettings={() => openSettings("providers")}
            />
          </div>
        )}

        <div className="shrink-0 px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto w-full max-w-2xl">
            <ChatComposer
              isBusy={isBusy}
              isResuming={isResuming}
              onCancel={requestCancellation}
              onOpenModels={() => setModelsOpen(true)}
              onOpenPersona={() => openSettings("preferences")}
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
        onOpenSettings={() => openSettings("providers")}
        open={modelsOpen}
      />
      <SettingsDialog
        // Remount when the requested tab changes so the dialog opens there.
        initialTab={settingsTab}
        key={settingsTab}
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
      className="absolute -bottom-6 left-0 h-6 gap-1 px-1.5 text-[10.5px] text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/msg:opacity-100"
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
