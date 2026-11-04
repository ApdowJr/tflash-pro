"use client";

import {
  ArrowRightIcon,
  BracesIcon,
  FileSearchIcon,
  FolderIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { FlashMark } from "@/components/brand/logo";
import { useAppSettings } from "@/components/settings/app-settings";
import type { TranslationKey } from "@/components/settings/i18n";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useWorkspace } from "@/components/settings/workspace-store";
import { AGENT_MODES, type AgentMode } from "@/lib/agent-modes";

const MODE_ICONS = {
  chat: MessageSquareTextIcon,
  coder: BracesIcon,
  research: FileSearchIcon,
} as const;

const MODE_PROMPTS: Record<AgentMode, readonly [TranslationKey, TranslationKey]> = {
  chat: ["suggestion1", "suggestion2"],
  coder: ["suggestion3", "suggestion5"],
  research: ["suggestion4", "suggestion6"],
};

/** A quiet launch surface for one new, mode-specific conversation. */
export function EmptyState({
  name,
  mode,
  onModeChange,
  onOpenProjects,
}: {
  readonly name: string;
  readonly mode: AgentMode;
  readonly onModeChange: (mode: AgentMode) => void;
  readonly onOpenProjects: () => void;
}) {
  const { t, settings } = useAppSettings();
  const controller = usePromptInputController();
  const { workspace, ready } = useWorkspace();
  const activeMode = AGENT_MODES.find((item) => item.id === mode) ?? AGENT_MODES[0];

  const addPrompt = (prompt: TranslationKey) => {
    controller.textInput.append(t(prompt));
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus();
    }, 0);
  };

  return (
    <div className="tf-rise mx-auto flex w-full max-w-3xl flex-col px-4 pt-[clamp(2rem,7vh,5rem)] pb-8 sm:px-6">
      <header className="mb-8">
        <div className="mb-5 flex items-center gap-3">
          <FlashMark className="size-9 rounded-[10px]" />
          <div>
            <p className="text-sm font-semibold tracking-[-0.01em] text-foreground">Tflash</p>
            <p className="text-xs text-muted-foreground">{activeMode.label[settings.language]}</p>
          </div>
        </div>
        <h1 className="text-balance text-[clamp(1.8rem,4vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.04em] text-foreground">
          {t("greeting")} {name}
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {activeMode.hint[settings.language]}. {t("modeSessionHint")}
        </p>
      </header>

      <section aria-label={settings.language === "so" ? "Dooro habka shaqada" : "Choose a way to work"}>
        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={settings.language === "so" ? "Habka wada-hadalka cusub" : "New conversation mode"}>
          {AGENT_MODES.map((item) => {
            const Icon = MODE_ICONS[item.id];
            const selected = mode === item.id;
            return (
              <button
                aria-pressed={selected}
                className={`group flex min-h-[104px] flex-col items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${selected ? "border-primary/40 bg-primary/[0.055]" : "border-border bg-card hover:border-foreground/20 hover:bg-accent/55"}`}
                key={item.id}
                onClick={() => onModeChange(item.id)}
                type="button"
              >
                <span className="flex w-full items-center gap-2.5">
                  <Icon aria-hidden="true" className={`size-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm font-semibold text-foreground">{item.label[settings.language]}</span>
                  {selected ? <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{item.hint[settings.language]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-8" aria-label={t("startWith")}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold text-foreground">{t("startWith")}</h2>
          <p className="hidden text-[11px] text-muted-foreground sm:block">{t("suggestionHint")}</p>
        </div>
        <div className="divide-y divide-border rounded-xl border bg-card">
          {MODE_PROMPTS[mode].map((prompt) => (
            <button
              className="group flex min-h-12 w-full items-center gap-3 px-3.5 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-11"
              key={prompt}
              onClick={() => addPrompt(prompt)}
              type="button"
            >
              <span className="min-w-0 flex-1">{t(prompt)}</span>
              <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" />
            </button>
          ))}
        </div>
      </section>

      <button
        className="mt-4 flex min-h-11 items-center gap-2 self-start rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpenProjects}
        type="button"
      >
        <FolderIcon aria-hidden="true" className="size-4" />
        <span>{t("projects")}</span>
        {ready && workspace.projects.length > 0 ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{workspace.projects.length}</span> : null}
        <ArrowRightIcon aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
