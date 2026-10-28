"use client";

import { FileIcon, PaperclipIcon, SquareIcon, WandSparklesIcon, XIcon } from "lucide-react";
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
import { getPersona } from "@/components/settings/personas";
import { useAppSettings } from "@/components/settings/app-settings";
import { cn } from "@/lib/utils";

/**
 * The composer is the one element people touch every turn, so it gets the
 * most care: one card, one row of quiet tools, one send affordance.
 */
export function ChatComposer({
  isBusy,
  isResuming,
  onCancel,
  onOpenModels,
  onOpenPersona,
  onSubmit,
}: {
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly onCancel: () => void;
  readonly onOpenModels: () => void;
  readonly onOpenPersona: () => void;
  readonly onSubmit: (message: PromptInputMessage) => Promise<void>;
}) {
  const { t } = useAppSettings();
  const controller = usePromptInputController();

  return (
    <PromptInput
      className="tflash-composer overflow-visible rounded-[1.35rem] border-border bg-card dark:bg-card focus-within:border-foreground/25! focus-within:ring-1 focus-within:ring-foreground/10"
      onSubmit={onSubmit}
    >
      <ComposerAttachments />
      <PromptInputTextarea
        className="min-h-[3.75rem] px-4 pt-3.5 pb-0 text-[15px] leading-relaxed placeholder:text-muted-foreground/70 md:text-[15px]"
        disabled={isResuming}
        placeholder={t("placeholder")}
      />
      <PromptInputFooter className="flex-wrap border-t-0 px-2.5 pt-1.5 pb-2.5 pr-14">
        <PromptInputTools className="gap-1">
          <ComposerModelButton onClick={onOpenModels} />
          <ComposerPersonaButton onClick={onOpenPersona} />
          <ComposerAttachButton />
        </PromptInputTools>
        <span className="hidden pr-1 text-[11px] text-muted-foreground/60 md:inline">
          {t("enterToSend")}
        </span>
      </PromptInputFooter>
      <ComposerAction
        hasInputText={controller.textInput.value.trim().length > 0}
        isBusy={isBusy}
        isResuming={isResuming}
        onCancel={onCancel}
      />
    </PromptInput>
  );
}

/** Pending files, shown above the textarea until the turn is sent. */
function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
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
            aria-label={`Remove ${file.filename}`}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
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

function ComposerModelButton({ onClick }: { readonly onClick: () => void }) {
  const { selection, t, isConnected } = useAppSettings();
  return (
    <PromptInputButton
      className="h-8 max-w-[8.5rem] gap-1.5 rounded-full px-2 text-[11.5px] text-muted-foreground hover:text-foreground sm:max-w-[13rem]"
      onClick={onClick}
      size="sm"
      tooltip={t("switchModel")}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isConnected(selection.providerId) ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
      <span className="truncate">{selection.modelId}</span>
    </PromptInputButton>
  );
}

function ComposerPersonaButton({ onClick }: { readonly onClick: () => void }) {
  const { settings, t } = useAppSettings();
  const persona = getPersona(settings.persona);
  return (
    <PromptInputButton
      className="h-8 gap-1.5 rounded-full px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
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
      className="size-8 rounded-full text-muted-foreground hover:text-foreground sm:size-7"
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
    return (
      <PromptInputSubmit
        className="right-2 bottom-2 size-9 bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40 sm:right-2.5 sm:bottom-2.5 sm:size-8"
        disabled={isResuming || (!canSubmit && !isBusy)}
      />
    );
  }

  return (
    <PromptInputButton
      aria-label="Stop"
      className="absolute right-2 bottom-2 size-9 rounded-full border-border bg-card sm:right-2.5 sm:bottom-2.5 sm:size-8"
      onClick={onCancel}
      variant="outline"
    >
      <SquareIcon className="size-3 fill-current" />
    </PromptInputButton>
  );
}
