"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  BrainIcon,
  CheckIcon,
  CopyIcon,
  PaperclipIcon,
  SparklesIcon,
  SquareIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";
import { AppHeader } from "@/components/app/app-header";
import { EmptyState } from "@/components/app/empty-state";
import { ModelPicker } from "@/components/app/model-picker";
import { getPersona } from "@/components/app/personas";
import { ProviderBadge } from "@/components/app/provider-badge";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { useAppSettings } from "@/components/app/settings-provider";
import { getProvider } from "@/lib/providers/catalog";
import { AgentMessage } from "./agent-message";

const DEFAULT_AGENT_NAME = "ururka-lps-agent";
const AGENT_NAME = WEB_CHAT_AGENT ?? DEFAULT_AGENT_NAME;

export function AgentChat({
  sessionId,
  sessionless = false,
}: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  return (
    <PromptInputProvider>
      <ChatSession sessionId={sessionId} sessionless={sessionless} />
    </PromptInputProvider>
  );
}

function ChatSession({
  sessionId,
  sessionless,
}: {
  readonly sessionId?: string;
  readonly sessionless: boolean;
}) {
  const {
    t,
    settings,
    selection,
    eveHeaders,
    turnContext,
    addChat,
  } = useAppSettings();
  const controller = usePromptInputController();
  const [cancellationError, setCancellationError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"providers" | "models" | "preferences">(
    "providers",
  );
  const [modelsOpen, setModelsOpen] = useState(false);
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
    if (sessionId !== undefined) {
      window.location.assign("/");
      return;
    }
    agent.reset();
    History.prototype.replaceState.call(window.history, window.history.state, "", "/");
    setCancellationError(undefined);
  };

  const openSettings = useCallback((tab: "providers" | "models" | "preferences" = "providers") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      `# ${AGENT_NAME}`,
      `> ${new Date().toISOString()} · ${selection.providerId}/${selection.modelId}`,
      "",
      ...agent.data.messages.map((message) => {
        const content = message.parts
          .filter((part) => part.type === "text")
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n\n")
          .trim();
        return `## ${message.role === "user" ? "You" : "Ururka"}\n\n${content}`;
      }),
    ].join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ururka-chat-${Date.now()}.md`;
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

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea disabled={isResuming} placeholder={t("placeholder")} />
      <PromptInputFooter className="border-t pr-12">
        <PromptInputTools>
          <ComposerModelButton onClick={() => setModelsOpen(true)} />
          <ComposerPersonaButton onClick={() => openSettings("preferences")} />
          <ComposerAttachButton />
        </PromptInputTools>
        <span className="hidden pr-1 text-[11px] text-muted-foreground/70 md:inline">
          ⌘K {t("models")}
        </span>
      </PromptInputFooter>
      <ComposerAction
        hasInputText={controller.textInput.value.trim().length > 0}
        isBusy={isBusy}
        isResuming={isResuming}
        onCancel={requestCancellation}
      />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        canExport={!isEmpty}
        onExportChat={exportChat}
        onNewChat={startNewChat}
        onOpenModels={() => setModelsOpen(true)}
        onOpenSettings={() => openSettings("providers")}
      />

      {showConversationLayout ? (
        <Conversation
          className="min-h-0 flex-1"
          initial={sessionId === undefined ? undefined : false}
          resize={activeSessionId === undefined ? "smooth" : "instant"}
          scrollRestorationKey={
            isEmpty || activeSessionId === undefined
              ? undefined
              : `eve:web-chat-scroll:${activeSessionId}`
          }
        >
          <ConversationTopFade className="top-14" />
          <ConversationContent className="ururka-scroll mx-auto w-full max-w-3xl gap-6 px-4 pt-20 pb-36 sm:px-6">
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
                    questionsFor={questionsFor}
                    onInputResponses={(inputResponses) => {
                      setCancellationError(undefined);
                      return agent.respond(inputResponses, { clientContext: turnContext() });
                    }}
                  />
                  {message.role === "assistant" ? (
                    <CopyMessageButton message={message} />
                  ) : null}
                </div>
              ),
            )}
            {showPendingThinking ? <PendingThinking /> : null}
            {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : (
        <div className="ururka-scroll min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            onOpenModels={() => setModelsOpen(true)}
            onOpenSettings={() => openSettings("providers")}
          />
        </div>
      )}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          showConversationLayout
            ? "fixed bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
            : "relative z-10 -mt-4 flex max-w-3xl flex-1 flex-col items-center justify-start pb-6",
        )}
      >
        <div className="w-full">{composer}</div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
          {t("poweredBy")} · {settings.language === "so" ? "Soomaali" : "English"}
        </p>
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
    </main>
  );
}

function ComposerModelButton({ onClick }: { readonly onClick: () => void }) {
  const { selection, t } = useAppSettings();
  const provider = getProvider(selection.providerId);
  return (
    <PromptInputButton
      className="h-7 max-w-[13rem] gap-1.5 px-2 text-[11px]"
      onClick={onClick}
      size="sm"
      tooltip={t("chooseModel")}
      type="button"
    >
      {provider ? <ProviderBadge provider={provider} size="sm" /> : <SparklesIcon className="size-3" />}
      <span className="truncate">{selection.modelId}</span>
    </PromptInputButton>
  );
}

function ComposerPersonaButton({ onClick }: { readonly onClick: () => void }) {
  const { settings, t } = useAppSettings();
  const persona = getPersona(settings.persona);
  return (
    <PromptInputButton
      className="h-7 gap-1.5 px-2 text-[11px]"
      onClick={onClick}
      size="sm"
      tooltip={t("persona")}
      type="button"
    >
      <WandSparklesIcon className="size-3" />
      <span className="hidden sm:inline">{persona.label[settings.language]}</span>
    </PromptInputButton>
  );
}

function ComposerAttachButton() {
  const { t } = useAppSettings();
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label={t("attach")}
      className="h-7 w-7"
      onClick={() => attachments.openFileDialog()}
      size="icon-sm"
      tooltip={t("attach")}
      type="button"
    >
      <PaperclipIcon className="size-3.5" />
    </PromptInputButton>
  );
}

function CopyMessageButton({ message }: { readonly message: { parts: readonly { type: string; text?: string }[] } }) {
  const { t } = useAppSettings();
  const [copied, setCopied] = useState(false);
  const hasText = message.parts.some((part) => part.type === "text" && part.text);
  if (!hasText) return null;
  return (
    <Button
      aria-label={t("copy")}
      className="absolute -bottom-6 left-0 h-6 px-1.5 text-[10px] opacity-0 transition-opacity group-hover/msg:opacity-100"
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

function ComposerAction({
  hasInputText,
  isBusy,
  isResuming,
  onCancel,
}: {
  readonly hasInputText: boolean;
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly onCancel: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const canSubmit = hasInputText || attachments.files.length > 0;

  if (!isBusy || canSubmit) {
    return <PromptInputSubmit disabled={isResuming} />;
  }

  return (
    <PromptInputButton
      aria-label="Stop"
      className="absolute right-2.5 bottom-2.5"
      onClick={onCancel}
      variant="outline"
    >
      <SquareIcon className="size-3 fill-current" />
    </PromptInputButton>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  const { t } = useAppSettings();
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">{t("requestFailed")}</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function PendingThinking() {
  const { t } = useAppSettings();
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon className="size-4" />
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
