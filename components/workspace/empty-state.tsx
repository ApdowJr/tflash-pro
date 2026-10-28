"use client";

import { BookOpenIcon, BracesIcon, LanguagesIcon, ListChecksIcon } from "lucide-react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useAppSettings } from "@/components/settings/app-settings";

const SUGGESTIONS = [
  { key: "suggestion1" as const, icon: BookOpenIcon },
  { key: "suggestion2" as const, icon: LanguagesIcon },
  { key: "suggestion3" as const, icon: BracesIcon },
  { key: "suggestion4" as const, icon: ListChecksIcon },
];

/** A quiet starting point; provider and connection controls live in one place. */
export function EmptyState() {
  const { t } = useAppSettings();
  const controller = usePromptInputController();

  const choose = (text: string) => {
    controller.textInput.setInput(text);
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus();
    }, 0);
  };

  return (
    <div className="tf-rise mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 pt-8 pb-8 sm:gap-9 sm:px-6 sm:pt-20">
      <div className="space-y-2.5">
        <h1 className="text-balance font-semibold text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[32px]">
          {t("welcome")}
        </h1>
        <p className="text-pretty text-muted-foreground text-sm leading-relaxed">{t("subtitle")}</p>
      </div>

      <div className="space-y-2.5">
        <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          {t("startWith")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(({ key, icon: Icon }) => (
            <button
              className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 px-3.5 py-3 text-left transition-colors hover:border-border hover:bg-card"
              key={key}
              onClick={() => choose(t(key))}
              type="button"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span className="min-w-0 flex-1 text-pretty text-[13px] text-foreground leading-snug">
                {t(key)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
