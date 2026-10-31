"use client";

import { useState } from "react";
import { DocumentImportButton } from "./documents";
import { VoiceInputButton } from "./voice-input";
import { FileIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
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
import { AGENT_MODES, type AgentMode } from "@/lib/agent-modes";

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
  mode = "chat",
  onModeChange,
}: {
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly cancelling?: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (message: PromptInputMessage) => Promise<void>;
  readonly mode?: AgentMode;
  readonly onModeChange?: (mode: AgentMode) => void;
}) {
  const { t, settings } = useAppSettings();
  const [documentPending, setDocumentPending] = useState(false);
  const controller = usePromptInputController();

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
      <AgentModePicker mode={mode} onChange={onModeChange} language={settings.language} disabled={isBusy || isResuming} />
      <PromptInput
        className="tflash-composer overflow-visible rounded-[1.35rem] border-border/80 bg-card dark:bg-card focus-within:border-foreground/25! focus-within:ring-1 focus-within:ring-foreground/10"
        onSubmit={onSubmit}
        onSubmitCapture={(event) => { if (documentPending) { event.preventDefault(); event.stopPropagation(); } }}
      >
        <ComposerAttachments />
        <PromptInputTextarea
          aria-label={t("messageInput")}
          className="min-h-[3.75rem] px-4 pt-3.5 pb-0 text-[15px] leading-relaxed placeholder:text-muted-foreground/70 md:text-[15px]"
          // Drafts remain editable while a session prepares or after an error;
          // Send stays disabled until it is safe to submit.
          placeholder={t("placeholder")}
        />
        <PromptInputFooter className={`flex-wrap border-t-0 px-2.5 pt-1.5 pb-2.5 ${isBusy && (controller.textInput.value.trim() || controller.attachments.files.length) ? "pr-24" : "pr-14"}`}>
          <PromptInputTools className="gap-1">
            <ComposerAttachButton />
            <DocumentImportButton disabled={isResuming} onPendingChange={setDocumentPending} />
            <VoiceInputButton disabled={isResuming} />
          </PromptInputTools>
          <span className="hidden pr-1 text-[11px] text-muted-foreground/60 md:inline">
            {t("enterToSend")}
          </span>
        </PromptInputFooter>
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
  return (
    <div aria-label={language === "so" ? "Habka agent-ka" : "Agent mode"} className="mb-2 flex flex-wrap gap-1" role="group">
      {AGENT_MODES.map((item) => (
        <button
          aria-pressed={mode === item.id}
          className={`tf-touch-target min-h-11 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${mode === item.id ? "border-foreground/25 bg-accent font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
          disabled={disabled || !onChange}
          key={item.id}
          onClick={() => onChange?.(item.id)}
          title={item.hint[language]}
          type="button"
        >
          {item.label[language]}
        </button>
      ))}
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
      {attachments.files.map((file) => (
        <span
          className="flex max-w-[15rem] items-center gap-1.5 rounded-md border border-border/70 bg-muted/60 py-1 pr-1 pl-2 text-[11px] text-foreground"
          key={file.id}
        >
          <FileIcon className="size-3 shrink-0 text-muted-foreground" />
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
      ))}
    </div>
  );
}

function ComposerAttachButton() {
  const { t } = useAppSettings();
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label={t("attach")}
      className="tf-touch-target size-8 rounded-full text-muted-foreground hover:text-foreground sm:size-7"
      onClick={() => attachments.openFileDialog()}
      size="icon-sm"
      tooltip={t("attach")}
      type="button"
    >
      <PaperclipIcon className="size-3.5" />
    </PromptInputButton>
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
    <>
      {isBusy ? (
        <PromptInputButton
          aria-label={t(cancelling ? "cancelling" : "stop")}
          className={`tf-touch-target absolute bottom-2 size-9 rounded-full border-border bg-card sm:bottom-2.5 sm:size-8 ${canSubmit ? "right-14 sm:right-12" : "right-2 sm:right-2.5"}`}
          disabled={cancelling}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          <SquareIcon className="size-3 fill-current" />
        </PromptInputButton>
      ) : null}
      {!isBusy || canSubmit ? (
        <PromptInputSubmit
          aria-label={t("send")}
          className="tf-touch-target right-2 bottom-2 size-9 bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40 sm:right-2.5 sm:bottom-2.5 sm:size-8"
          disabled={isResuming || cancelling || !canSubmit}
        />
      ) : null}
    </>
  );
}
