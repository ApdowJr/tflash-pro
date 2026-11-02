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

/** A focused start screen: no synthetic usage metrics or claims. */
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
    <div className="tf-rise mx-auto flex w-full max-w-3xl flex-col px-4 pt-[clamp(3.5rem,12vh,8rem)] pb-8 sm:px-6">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-5 rounded-[18px] p-1.5 shadow-[0_8px_24px_-14px_rgba(27,25,22,0.45)] ring-1 ring-border/80">
          <FlashMark className="size-10 rounded-xl" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tflash</p>
        <h1 className="mt-2 text-balance text-[30px] font-semibold leading-tight tracking-[-0.04em] sm:text-[38px]">
          {t("welcome")}
        </h1>
        <p className="mt-2 max-w-md text-pretty text-[14px] leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <section aria-label={t("startWith")} className="mx-auto w-full max-w-2xl">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{t("startWith")}</h2>
          <p className="text-[11px] text-muted-foreground/70">{t("suggestionHint")}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(({ key, label, icon: Icon }) => (
            <button
              className="group flex min-h-[72px] items-center gap-3 rounded-2xl border border-border/75 bg-card/80 px-3.5 py-3 text-left transition duration-150 hover:-translate-y-0.5 hover:border-[#c9953d]/40 hover:bg-card hover:shadow-[0_12px_28px_-20px_rgba(40,33,22,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              key={key}
              onClick={() => choose(t(key))}
              type="button"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/75 transition-colors group-hover:bg-[#f3bd56]/20 group-hover:text-[#765323]">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{t(label)}</span>
                <span className="block text-pretty text-[13px] font-medium leading-snug text-foreground">{t(key)}</span>
              </span>
              <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
