"use client";

import { useCallback, useRef, useState } from "react";
import { DocumentImportButton } from "./documents";
import { VoiceInputButton } from "./voice-input";
import { BracesIcon, ChevronDownIcon, FileIcon, FileSearchIcon, MessageSquareTextIcon, PlusIcon, SparklesIcon, SquareIcon, XIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { useAppSettings } from "@/components/settings/app-settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AGENT_MODES, type AgentMode } from "@/lib/agent-modes";
import { defaultProvider, findModel, getProvider } from "@/lib/providers/catalog";

/**
 * The composer is the one element people touch every turn, so it gets the
 * most care: one card, one row of quiet tools, one send affordance.
 */
export function ChatComposer({
  isBusy,
  isResuming,
  cancelling = false,
  onCancel,
  onSubmit,
  onOpenModels,
  mode = "chat",
}: {
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly cancelling?: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (message: PromptInputMessage) => Promise<void>;
  /** Opens the model picker; omitted when the caller has no picker to show. */
  readonly onOpenModels?: () => void;
  readonly mode?: AgentMode;
}) {
  const { t, settings } = useAppSettings();
  const controller = usePromptInputController();
  const [documentPending, setDocumentPending] = useState(false);
  const openDocumentImport = useRef<() => void>(() => {});
  const setDocumentImportOpener = useCallback((open: () => void) => { openDocumentImport.current = open; }, []);

  return (
    <>
      {controller.textInput.failedDrafts.map((draft) => (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs" key={draft.id} role="alert">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-destructive">{t("draftNotSent")}</p>
            <p className="mt-1 line-clamp-2 break-words text-muted-foreground">{draft.text}</p>
          </div>
          <button
            className="tf-touch-target min-h-11 shrink-0 rounded-md px-2 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => {
              const current = controller.textInput.value;
              controller.textInput.setInput(current ? `${draft.text}\n\n${current}` : draft.text);
              controller.textInput.discardFailed(draft.id);
            }}
            type="button"
          >
            {t("restoreDraft")}
          </button>
          <button aria-label={t("dismiss")} className="tf-touch-target flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" onClick={() => controller.textInput.discardFailed(draft.id)} type="button">
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
      {mode !== "chat" ? (
        <div className="mb-2 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{mode === "coder" ? t("coderContextHint") : t("deepResearch")}</span>
          {mode === "research" ? <span>{t("deepResearchHint")}</span> : (
            <>
              <button
                className="min-h-9 rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  const template = settings.language === "so"
                    ? "Hawl coding:\nRepository: [magaca ama URL]\nBranch: [branch-ka]\nWaxa la qabanayo: [sharax hawsha]\nTijaabooyinka ama shuruudaha: [ikhtiyaari]"
                    : "Coding task:\nRepository: [name or URL]\nBranch: [branch]\nTask: [describe the work]\nTests or acceptance criteria: [optional]";
                  const current = controller.textInput.value;
                  controller.textInput.setInput(current ? `${current}\n\n${template}` : template);
                }}
                type="button"
              >
                {settings.language === "so" ? "Ku dar qaab hawleed" : "Insert task template"}
              </button>
              <span className="hidden lg:inline">{settings.language === "so" ? "Tani ma xirayso repo mana dirayso fariin. Ha gelin sir ama token." : "Does not connect a repository or send a message. Do not include secrets or tokens."}</span>
            </>
          )}
        </div>
      ) : null}
      <PromptInput
        className="tflash-composer overflow-visible rounded-2xl border-border bg-card shadow-[var(--shell-shadow)] focus-within:border-primary/45! focus-within:ring-2 focus-within:ring-primary/10"
        dropLabel={t("dropFilesHere")}
        globalDrop
        onSubmit={onSubmit}
        onSubmitCapture={(event) => { if (documentPending) { event.preventDefault(); event.stopPropagation(); } }}
      >
        <ComposerAttachments />
        <PromptInputTextarea
          aria-label={t("messageInput")}
          className="min-h-[3.75rem] px-4 pt-3.5 pb-0 text-[15px] leading-relaxed placeholder:text-muted-foreground/70 md:text-[15px]"
          // Drafts remain editable while a session prepares or after an error;
          // Send stays disabled until it is safe to submit.
          placeholder={t(mode === "coder" ? "coderPlaceholder" : mode === "research" ? "researchPlaceholder" : "chatPlaceholder")}
        />
        <PromptInputFooter className={`flex-wrap border-t-0 px-2.5 pt-1.5 pb-2.5 ${(!isBusy || controller.textInput.value.trim() || controller.attachments.files.length) ? "pr-24" : "pr-14"}`}>
          <PromptInputTools className="min-w-0 gap-1">
            <ComposerAttachButton onImportDocument={() => openDocumentImport.current()} />
            <ComposerModelButton onOpen={onOpenModels} />
          </PromptInputTools>
          <span className="hidden pr-1 text-[11px] text-muted-foreground/60 md:inline">
            {t("enterToSend")}
          </span>
        </PromptInputFooter>
        <DocumentImportButton disabled={isResuming} hideTrigger onPendingChange={setDocumentPending} onRequestImportReady={setDocumentImportOpener} />
        <ComposerAction
          hasInputText={controller.textInput.value.trim().length > 0}
          isBusy={isBusy}
          isResuming={isResuming || documentPending}
          cancelling={cancelling}
          onCancel={onCancel}
        />
      </PromptInput>
    </>
  );
}

export function AgentModePicker({ mode, onChange, language, disabled }: { mode: AgentMode; onChange?: (mode: AgentMode) => void; language: "en" | "so"; disabled: boolean }) {
  const icons = { chat: MessageSquareTextIcon, coder: BracesIcon, research: FileSearchIcon };
  return (
    <div aria-label={language === "so" ? "Habka agent-ka" : "Agent mode"} className="grid grid-cols-3 gap-1 rounded-xl border bg-background/55 p-1" role="group">
      {AGENT_MODES.map((item) => {
        const Icon = icons[item.id];
        const selected = mode === item.id;
        return (
          <button
            aria-pressed={selected}
            className={`tf-touch-target inline-flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 text-center text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-border bg-card text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground"}`}
            disabled={disabled || !onChange}
            key={item.id}
            onClick={() => onChange?.(item.id)}
            title={item.hint[language]}
            type="button"
          >
            <Icon aria-hidden="true" className={`size-3.5 ${selected ? "text-primary" : ""}`} />
            <span className="max-w-full truncate">{item.label[language]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Pending files, shown above the textarea until the turn is sent. */
function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
  const { t } = useAppSettings();
  if (attachments.files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith("image/") && Boolean(file.url);
        return (
          <span
            className="flex max-w-[15rem] items-center gap-1.5 rounded-lg border border-border/70 bg-muted/60 py-1 pr-1 pl-1.5 text-[11px] text-foreground"
            key={file.id}
          >
            {isImage ? (
              <img
                alt={file.filename ?? t("attachmentLabel")}
                className="size-7 shrink-0 rounded border border-border/50 object-cover"
                src={file.url}
              />
            ) : (
              <FileIcon className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{file.filename}</span>
            <button
              aria-label={`${t("removeAttachment")}: ${file.filename}`}
              className="tf-touch-target flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => attachments.remove(file.id)}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The current provider/model, one tap away from the picker. The composer is
 * where a turn starts, so this is the place a model change is actually
 * discoverable; the full picker still owns provider switching and keys.
 */
function ComposerModelButton({ onOpen }: { readonly onOpen?: () => void }) {
  const { t, selection } = useAppSettings();
  if (!onOpen) return null;
  const provider = getProvider(selection.providerId) ?? defaultProvider();
  const model = findModel(provider, selection.modelId);
  const label = model?.name ?? selection.modelId;
  return (
    <PromptInputButton
      aria-label={`${t("modelPickerHint")}: ${provider.name} · ${label}`}
      className="tf-touch-target h-8 max-w-[9rem] min-w-0 rounded-full px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground sm:max-w-[13rem] sm:h-7"
      onClick={onOpen}
      size="sm"
      title={`${t("chooseModel")} · ${provider.name}`}
      tooltip={t("modelPickerHint")}
      type="button"
    >
      <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
    </PromptInputButton>
  );
}

function ComposerAttachButton({ onImportDocument }: { readonly onImportDocument: () => void }) {
  const { t } = useAppSettings();
  const attachments = usePromptInputAttachments();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton
          aria-label={t("attach")}
          className="tf-touch-target size-8 rounded-full text-muted-foreground hover:text-foreground sm:size-7"
          size="icon-sm"
          tooltip={t("attach")}
          type="button"
        >
          <PlusIcon className="size-5" />
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem onSelect={() => attachments.openFileDialog()}>{t("attach")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportDocument}>{t("importDocument")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComposerAction({
  hasInputText,
  isBusy,
  isResuming,
  cancelling,
  onCancel,
}: {
  readonly hasInputText: boolean;
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const { t } = useAppSettings();
  const canSubmit = hasInputText || attachments.files.length > 0;

  return (
    <div className="absolute right-2 bottom-2 z-10 flex items-center gap-1.5 sm:right-2.5 sm:bottom-2.5">
      {isBusy ? (
        <PromptInputButton
          aria-label={t(cancelling ? "cancelling" : "stop")}
          className="tf-touch-target size-8 shrink-0 rounded-full border-border bg-card sm:size-8"
          disabled={cancelling}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          <SquareIcon className="size-3 fill-current" />
        </PromptInputButton>
      ) : (
        <VoiceInputButton disabled={isResuming || cancelling} />
      )}
      {(!isBusy || canSubmit) ? (
        <PromptInputSubmit
          aria-label={t("send")}
          className="tf-touch-target static right-auto bottom-auto size-8 shrink-0 bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 sm:size-8"
          disabled={isResuming || cancelling || !canSubmit}
        />
      ) : null}
    </div>
  );
}
