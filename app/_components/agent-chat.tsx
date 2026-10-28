"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon, BrainIcon, CheckIcon, CopyIcon, FileIcon, PaperclipIcon,
  SparklesIcon, SquareIcon, WandSparklesIcon, XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Conversation, ConversationContent, ConversationScrollButton, ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput, PromptInputButton, type PromptInputMessage, PromptInputFooter,
  PromptInputProvider, PromptInputSubmit, PromptInputTextarea, PromptInputTools,
  usePromptInputAttachments, usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";
import { EmptyState } from "@/components/app/empty-state";
import { ModelPicker } from "@/components/app/model-picker";
import { getPersona } from "@/components/app/personas";
import { ProviderBadge } from "@/components/app/provider-badge";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { useAppSettings } from "@/components/app/settings-provider";
import { WorkspaceShell, type AppUser } from "@/components/app/workspace-shell";
import { getProvider } from "@/lib/providers/catalog";
import { AgentMessage } from "./agent-message";

const AGENT_NAME = "Tflash";

type ReadySession = { readonly id: string; readonly resume: boolean };

/** Create sessions through our server first so each one has a verifiable owner. */
export function AgentChat({ sessionId, sessionless = false, user }: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
  readonly user: AppUser;
}) {
  const { hydrated, eveHeaders } = useAppSettings();
  const [ready, setReady] = useState<ReadySession | undefined>(
    sessionId ? { id: sessionId, resume: true } : undefined,
  );
  const [preparationError, setPreparationError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const createRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (sessionId || !hydrated) return;
    let active = true;
    if (!createRef.current) {
      createRef.current = fetch("/api/chats", {
        method: "POST",
        headers: { ...eveHeaders(), "content-type": "application/json" },
        body: "{}",
      }).then(async (response) => {
        const body = await response.json() as { sessionId?: string; error?: string };
        if (!response.ok || !body.sessionId) throw new Error(body.error || "Could not start a conversation.");
        return body.sessionId;
      });
    }
    createRef.current.then((id) => {
      if (active) { setReady({ id, resume: false }); setPreparationError(undefined); }
    }).catch((error: unknown) => {
      if (active) setPreparationError(error instanceof Error ? error.message : "Could not start a conversation.");
    });
    return () => { active = false; };
  }, [sessionId, hydrated, attempt, eveHeaders]);

  const retry = () => {
    createRef.current = null;
    setPreparationError(undefined);
    setAttempt((value) => value + 1);
  };
  return (
    <PromptInputProvider>
      <ChatSession
        key={ready?.id ?? "preparing"}
        sessionId={ready?.id}
        resume={ready?.resume ?? false}
        sessionless={sessionless}
        preparationError={preparationError}
        onRetry={retry}
        user={user}
      />
    </PromptInputProvider>
  );
}

function ChatSession({ sessionId, resume, sessionless, preparationError, onRetry, user }: {
  readonly sessionId?: string;
  readonly resume: boolean;
  readonly sessionless: boolean;
  readonly preparationError?: string;
  readonly onRetry: () => void;
  readonly user: AppUser;
}) {
  const { t, settings, selection, eveHeaders, turnContext, addChat } = useAppSettings();
  const controller = usePromptInputController();
  const [cancellationError, setCancellationError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"providers" | "models" | "preferences">("providers");
  const [modelsOpen, setModelsOpen] = useState(false);
  const hasSubmittedMessage = useRef(false);

  const replaceSessionRoute = (nextSessionId: string) => {
    if (resume) return;
    // Avoid remounting while a stream is active.
    History.prototype.replaceState.call(window.history, window.history.state, "", `/s/${encodeURIComponent(nextSessionId)}`);
  };

  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    headers: eveHeaders,
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
  const isPendingAssistantShell = lastMessage?.role === "assistant" && lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking = isBusy && (agent.status === "submitted" || lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const turnFailure = isBusy || isResuming ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const showConversationLayout = isResuming || sessionless || !isEmpty || errorMessage !== undefined;
  const activeSessionId = sessionId ?? agent.session?.sessionId;
  const canRespond = (requestId: string) => !isResuming && agent.data.inputs[requestId]?.status === "open";
  const questionsFor = (callId: string) => Object.values(agent.data.inputs).filter(
    (input) => input.request.kind === "question" && input.request.action.callId === callId,
  );

  const startNewChat = () => window.location.assign("/");
  const openSettings = useCallback((tab: "providers" | "models" | "preferences" = "providers") => {
    setSettingsTab(tab); setSettingsOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setModelsOpen(true); }
      else if (event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); startNewChat(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const exportChat = () => {
    const markdown = [
      `# ${AGENT_NAME}`,
      `> ${new Date().toISOString()} · ${selection.providerId}/${selection.modelId}`,
      "",
      ...agent.data.messages.map((message) => {
        const content = message.parts.filter((part) => part.type === "text")
          .map((part) => (part.type === "text" ? part.text : "")).join("\n\n").trim();
        return `## ${message.role === "user" ? "You" : "Tflash"}\n\n${content}`;
      }),
    ].join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a"); link.href = url; link.download = `tflash-chat-${Date.now()}.md`; link.click();
    URL.revokeObjectURL(url);
  };

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => setCancellationError(toErrorMessage(error)));
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
      // Persist the title before sending. On failure the composer keeps the draft.
      await addChat(sessionId, title);
    } catch (error) {
      setCancellationError(toErrorMessage(error));
      throw error;
    }
    hasSubmittedMessage.current = true;
    replaceSessionRoute(sessionId);
    const options = { clientContext: turnContext(), ...(isBusy ? { turnPolicy: "steer" as const } : {}) };
    if (message.files.length === 0) { await agent.send(text, options); return; }
    const parts: UserContent = [];
    if (text.length > 0) parts.push({ text, type: "text" });
    for (const file of message.files) parts.push({ data: file.url, filename: file.filename, mediaType: file.mediaType, type: "file" });
    await agent.send(parts, options);
  };

  const composer = (
    <PromptInput className="tflash-composer" onSubmit={handleSubmit}>
      <ComposerAttachments />
      <PromptInputTextarea className="tflash-composer-text" disabled={isResuming || !sessionId} placeholder={t("placeholder")} />
      <PromptInputFooter className="tflash-composer-footer pr-12">
        <PromptInputTools>
          <ComposerAttachButton disabled={!sessionId} />
          <ComposerModelButton onClick={() => setModelsOpen(true)} />
          <ComposerPersonaButton onClick={() => openSettings("preferences")} />
        </PromptInputTools>
      </PromptInputFooter>
      <ComposerAction hasInputText={controller.textInput.value.trim().length > 0} isBusy={isBusy} isResuming={isResuming || !sessionId} onCancel={requestCancellation} />
    </PromptInput>
  );

  return (
    <WorkspaceShell user={user} sessionId={activeSessionId} canExport={!isEmpty}
      onExportChat={exportChat} onNewChat={startNewChat} onOpenModels={() => setModelsOpen(true)}
      onOpenSettings={() => openSettings("providers")}>
      {showConversationLayout ? (
        <>
          <Conversation className="min-h-0 flex-1" initial={resume ? false : undefined}
            resize={activeSessionId ? "instant" : "smooth"}
            scrollRestorationKey={isEmpty || !activeSessionId ? undefined : `eve:web-chat-scroll:${activeSessionId}`}>
            <ConversationTopFade />
            <ConversationContent className="ururka-scroll mx-auto w-full max-w-3xl gap-8 px-5 pt-10 pb-8 sm:px-8">
              {agent.data.messages.map((message, index) =>
                showPendingThinking && isPendingAssistantShell && message.id === lastMessage.id ? null : (
                  <div className="group/msg relative" key={message.id}>
                    <AgentMessage canRespond={canRespond} isStreaming={agent.status === "streaming" && index === agent.data.messages.length - 1}
                      message={message} questionsFor={questionsFor} onInputResponses={(inputResponses) => {
                        setCancellationError(undefined); return agent.respond(inputResponses, { clientContext: turnContext() });
                      }} />
                    {message.role === "assistant" ? <CopyMessageButton message={message} /> : null}
                  </div>
                ),
              )}
              {showPendingThinking ? <PendingThinking /> : null}
              {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <div className="workspace-chat-composer"><div>{composer}<p>{settings.language === "so" ? "AI wuu qaldami karaa. Hubi macluumaadka muhiimka ah." : "AI can make mistakes. Check important information."}</p></div></div>
        </>
      ) : (
        <div className="workspace-home-scroll ururka-scroll">
          <EmptyState composer={composer} onOpenModels={() => setModelsOpen(true)} onOpenSettings={() => openSettings("providers")}
            preparing={!sessionId && !preparationError} preparationError={preparationError} onRetry={onRetry} />
        </div>
      )}
      <ModelPicker onOpenChange={setModelsOpen} onOpenSettings={() => openSettings("providers")} open={modelsOpen} />
      <SettingsDialog initialTab={settingsTab} key={settingsTab} onOpenChange={setSettingsOpen} open={settingsOpen} />
    </WorkspaceShell>
  );
}

function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
  if (!attachments.files.length) return null;
  return <div className="tflash-attachments">{attachments.files.map((file) => (
    <span key={file.id}><FileIcon size={14} /><span>{file.filename || "Attachment"}</span>
      <button aria-label={`Remove ${file.filename || "attachment"}`} onClick={() => attachments.remove(file.id)} type="button"><XIcon size={14} /></button>
    </span>
  ))}</div>;
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

function ComposerAttachButton({ disabled }: { readonly disabled: boolean }) {
  const { t } = useAppSettings();
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label={t("attach")}
      disabled={disabled}
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
