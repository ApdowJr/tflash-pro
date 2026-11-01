"use client";

import { ArrowUpRightIcon, BookOpenIcon, BracesIcon, LanguagesIcon, ListChecksIcon, SparklesIcon } from "lucide-react";
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
    controller.textInput.append(text);
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus();
    }, 0);
  };

  return (
    <div className="tf-rise mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 pt-7 pb-8 sm:gap-9 sm:px-6 sm:pt-14">
      <div className="rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(243,189,86,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.96))] p-5 shadow-[0_18px_40px_-28px_rgba(31,26,20,0.44)] sm:p-7">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[#f4efe7] ring-1 ring-[#eadfbe]">
            <FlashMark className="size-8" />
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tflash</p>
            <p className="text-[12px] text-muted-foreground">AI workspace</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#f3bd56]/35 bg-[#f9f0d7] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#865d25]">
              <SparklesIcon className="size-3" />
              {t("welcome")}
            </div>
            <h1 className="text-balance font-semibold text-[27px] leading-[1.1] tracking-[-0.03em] sm:text-[34px]">
              {t("welcome")}
            </h1>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-2xl border border-border/70 bg-background/70 px-2.5 py-2 text-center">
              <div className="text-[18px] font-semibold text-foreground">3</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Modes</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 px-2.5 py-2 text-center">
              <div className="text-[18px] font-semibold text-foreground">15+</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Models</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 px-2.5 py-2 text-center">
              <div className="text-[18px] font-semibold text-foreground">1</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Flow</div>
            </div>
          </div>
        </div>

        <p className="mt-5 max-w-2xl text-pretty text-muted-foreground text-sm leading-relaxed">{t("subtitle")}</p>
      </div>

      <section aria-label={t("startWith")} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-semibold text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t("startWith")}</h2>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("suggestionHint")}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(({ key, label, icon: Icon }) => (
            <button
              className="group flex min-h-16 items-start gap-3 rounded-2xl border border-border/70 bg-card/80 px-3.5 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#f3bd56]/40 hover:bg-accent/70"
              key={key}
              onClick={() => choose(t(key))}
              type="button"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(180deg,#f7ebd0,#f2e5c0)] text-[#825d28]">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-[11px] font-semibold text-muted-foreground">{t(label)}</span>
                <span className="block text-pretty text-[13px] leading-snug text-foreground">{t(key)}</span>
              </span>
              <ArrowUpRightIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

