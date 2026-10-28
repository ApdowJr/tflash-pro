"use client";

import {
  ArrowRightIcon,
  BookOpenIcon,
  BracesIcon,
  LanguagesIcon,
  KeyRoundIcon,
  ListChecksIcon,
  WrenchIcon,
} from "lucide-react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useAppSettings } from "@/components/settings/app-settings";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  { key: "suggestion1" as const, icon: BookOpenIcon },
  { key: "suggestion2" as const, icon: LanguagesIcon },
  { key: "suggestion3" as const, icon: BracesIcon },
  { key: "suggestion4" as const, icon: ListChecksIcon },
];

/**
 * First screen. One greeting, four suggestions, and the honest state of the
 * connection — no badges, mascots, or decorative gradients.
 */
export function EmptyState({
  onOpenConnections,
  onOpenSettings,
}: {
  readonly onOpenConnections: () => void;
  readonly onOpenSettings: () => void;
}) {
  const { t, settings, envConfigured, selection, isConnected } = useAppSettings();
  const controller = usePromptInputController();

  const hasConnection =
    Object.keys(settings.connections).length > 0 ||
    Object.entries(envConfigured).some(([id, configured]) => id !== "gateway" && configured) ||
    (selection.providerId !== "gateway" && isConnected(selection.providerId));

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
        <p className="max-w-xl text-pretty text-muted-foreground text-sm leading-relaxed">
          {t("subtitle")}
        </p>
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

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          <WrenchIcon className="size-3" />
          {t("toolsTitle")}
        </p>
        <button
          className="flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-card"
          onClick={onOpenConnections}
          type="button"
        >
          {[...INTEGRATIONS]
            .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
            .slice(0, 6)
            .map((integration) => (
              <span
                className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                key={integration.id}
              >
                {integration.name}
              </span>
            ))}
          <span className="ml-auto flex shrink-0 items-center gap-1 pt-1 text-[11px] text-muted-foreground">
            {t("connections")}
            <ArrowRightIcon className="size-3" />
          </span>
        </button>
        <p className="px-1 text-[11px] text-muted-foreground/75">{t("toolsHint")}</p>
      </div>

      {hasConnection ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
          {t("connectionReady")}
        </p>
      ) : (
        <button
          className={cn(
            "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl border border-brand/35 bg-brand/8 px-3.5 py-2.5 text-left text-[12px] leading-snug",
            "text-foreground/90 transition-colors hover:bg-brand/14",
          )}
          onClick={onOpenSettings}
          type="button"
        >
          <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-pretty">{t("demoHint")}</span>
          <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
            {t("connectNow")}
            <ArrowRightIcon className="size-3" />
          </span>
        </button>
      )}
    </div>
  );
}
