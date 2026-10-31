"use client";

import { ArrowUpRightIcon, BookOpenIcon, BracesIcon, LanguagesIcon, ListChecksIcon } from "lucide-react";
import { FlashMark } from "@/components/brand/logo";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useAppSettings } from "@/components/settings/app-settings";

const SUGGESTIONS = [
  { key: "suggestion1" as const, label: "suggestionLearn" as const, icon: BookOpenIcon },
  { key: "suggestion2" as const, label: "suggestionWrite" as const, icon: LanguagesIcon },
  { key: "suggestion3" as const, label: "suggestionCode" as const, icon: BracesIcon },
  { key: "suggestion4" as const, label: "suggestionResearch" as const, icon: ListChecksIcon },
];

/** A quiet starting point; provider and connection controls live in one place. */
export function EmptyState() {
  const { t } = useAppSettings();
  const controller = usePromptInputController();

  const choose = (text: string) => {
    // Suggestions only add to the draft; never erase what the user typed or send.
    controller.textInput.append(text);
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus();
    }, 0);
  };

  return (
    <div className="tf-rise mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 pt-7 pb-8 sm:gap-9 sm:px-6 sm:pt-16">
      <div className="space-y-4">
        <div aria-hidden="true" className="flex items-center gap-3">
          <FlashMark className="size-10 rounded-xl shadow-sm sm:size-11" />
          <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground">Tflash</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-balance font-semibold text-[27px] leading-[1.15] tracking-[-0.03em] sm:text-[34px]">
            {t("welcome")}
          </h1>
          <p className="max-w-lg text-pretty text-muted-foreground text-sm leading-relaxed">{t("subtitle")}</p>
        </div>
      </div>

      <section aria-label={t("startWith")} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-semibold text-xs text-foreground">{t("startWith")}</h2>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("suggestionHint")}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(({ key, label, icon: Icon }) => (
            <button
              className="group flex min-h-16 items-start gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3 text-left shadow-sm transition-colors hover:border-foreground/25 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
              key={key}
              onClick={() => choose(t(key))}
              type="button"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-foreground"><Icon aria-hidden="true" className="size-4" /></span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-[11px] font-semibold text-muted-foreground">{t(label)}</span>
                <span className="block text-pretty text-[13px] leading-snug text-foreground">{t(key)}</span>
              </span>
              <ArrowUpRightIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
