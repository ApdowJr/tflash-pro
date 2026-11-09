"use client";

import { ArrowUpRightIcon, Code2Icon, FileSearchIcon, KeyRoundIcon, MessageSquareIcon, SparklesIcon } from "lucide-react";
import { FlashMark } from "@/components/brand/logo";
import { useAppSettings } from "@/components/settings/app-settings";
import type { TranslationKey } from "@/components/settings/i18n";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { AGENT_MODES, type AgentMode } from "@/lib/agent-modes";
import { cn } from "@/lib/utils";

const MODE_PROMPTS: Record<AgentMode, readonly [TranslationKey, TranslationKey]> = {
  chat: ["suggestion1", "suggestion2"],
  coder: ["suggestion3", "suggestion5"],
  research: ["suggestion4", "suggestion6"],
};

const MODE_ICONS = {
  chat: MessageSquareIcon,
  coder: Code2Icon,
  research: FileSearchIcon,
} as const;

/**
 * Quiet launch surface with greeting, optional mode switcher pills,
 * setup hint when no provider credential is configured, and prompt starters.
 */
export function EmptyState({
  name,
  mode,
  onModeChange,
  onOpenSettings,
}: {
  readonly name: string;
  readonly mode: AgentMode;
  readonly onModeChange?: (mode: AgentMode) => void;
  readonly onOpenSettings?: () => void;
}) {
  const { t, settings, hydrated, providersLoaded, isConnected } = useAppSettings();
  const controller = usePromptInputController();
  const activeMode = AGENT_MODES.find((item) => item.id === mode) ?? AGENT_MODES[0];
  const needsProvider = hydrated && providersLoaded && !isConnected(settings.providerId);

  const addPrompt = (prompt: TranslationKey) => {
    controller.textInput.append(t(prompt));
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus();
    }, 0);
  };

  return (
    <div className="tf-rise mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-[clamp(3rem,12vh,8rem)] pb-8 text-center sm:px-6">
      <div className="mb-5 flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1.5">
        <FlashMark className="size-5 rounded-md" />
        <span className="text-xs font-semibold tracking-tight text-foreground">Tflash</span>
        <span className="h-3 w-px bg-border" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{activeMode.label[settings.language]}</span>
      </div>

      <h1 className="text-balance text-[clamp(2rem,5vw,3rem)] font-semibold leading-[1.1] tracking-[-0.045em] text-foreground">
        {t("greeting")} {name}
      </h1>
      <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
        {settings.language === "so"
          ? "Maxaan maanta kaa caawin karaa?"
          : "What would you like to work on today?"}
      </p>

      {onModeChange ? (
        <div
          aria-label={t("chooseModeLabel")}
          className="mt-6 flex flex-wrap justify-center gap-2"
          role="group"
        >
          {AGENT_MODES.map((item) => {
            const Icon = MODE_ICONS[item.id];
            const selected = item.id === mode;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary/45 bg-primary/10 text-foreground"
                    : "border-border/80 bg-card/55 text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                )}
                key={item.id}
                onClick={() => onModeChange(item.id)}
                title={item.hint[settings.language]}
                type="button"
              >
                <Icon aria-hidden="true" className="size-3.5" />
                <span>{item.label[settings.language]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {needsProvider && onOpenSettings ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-2 text-xs text-foreground">
          <KeyRoundIcon aria-hidden="true" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{t("onboardingNoProviderTitle")}</span>
          <button
            className="font-semibold text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOpenSettings}
            type="button"
          >
            {t("onboardingConnectProvider")}
          </button>
        </div>
      ) : null}

      <section className="mt-8 w-full max-w-xl" aria-label={t("startWith")}>
        <div className="mb-2 flex items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground">
          <SparklesIcon className="size-3.5" aria-hidden="true" />
          <span>{t("startWith")}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {MODE_PROMPTS[mode].map((prompt) => (
            <button
              className="group inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-border/80 bg-card/55 px-3.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={prompt}
              onClick={() => addPrompt(prompt)}
              type="button"
            >
              <span className="truncate">{t(prompt)}</span>
              <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
