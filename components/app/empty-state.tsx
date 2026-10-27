"use client";

import {
  ArrowUpRightIcon,
  BlocksIcon,
  KeyRoundIcon,
  LanguagesIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { getProvider } from "@/lib/providers/catalog";
import { cn } from "@/lib/utils";
import { ProviderBadge, StatusDot } from "./provider-badge";
import { useAppSettings } from "./settings-provider";

const SUGGESTIONS = [
  { key: "suggestion1" as const, icon: BlocksIcon },
  { key: "suggestion2" as const, icon: LanguagesIcon },
  { key: "suggestion3" as const, icon: ZapIcon },
  { key: "suggestion4" as const, icon: SparklesIcon },
];

export function EmptyState({
  onOpenSettings,
  onOpenModels,
}: {
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
}) {
  const { t, selection, isConnected, settings, envConfigured } = useAppSettings();
  const controller = usePromptInputController();
  const provider = getProvider(selection.providerId);
  const hasConnection =
    Object.keys(settings.connections).length > 0 ||
    Object.entries(envConfigured).some(
      ([id, configured]) => id !== "gateway" && configured,
    ) ||
    (selection.providerId !== "gateway" && isConnected(selection.providerId));

  const choose = (text: string) => {
    controller.textInput.setInput(text);
    window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-slot="input-group-control"]',
      );
      textarea?.focus();
    }, 0);
  };

  return (
    <div className="ururka-rise relative mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-4 pt-24 pb-8 text-center sm:pt-28">
      <div aria-hidden="true" className="ururka-grid pointer-events-none absolute inset-0 -z-10" />

      <div className="flex flex-col items-center gap-4">
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg">
          <svg className="size-8" fill="none" viewBox="0 0 24 24">
            <path
              d="M4 18V7.5L12 4l8 3.5V18l-8 3-8-3Z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
            <path d="M4 7.5 12 11l8-3.5M12 11v10" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </span>
        <div className="space-y-1.5">
          <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t("welcome")}</h1>
          <p className="mx-auto max-w-lg text-muted-foreground text-sm sm:text-base">
            {t("subtitle")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:border-foreground/30"
          onClick={onOpenModels}
          type="button"
        >
          {provider ? <ProviderBadge provider={provider} size="sm" /> : null}
          <StatusDot active={isConnected(selection.providerId)} />
          <span className="max-w-[14rem] truncate font-medium">{selection.modelId}</span>
          <span className="text-muted-foreground">· {t("models")}</span>
          <ArrowUpRightIcon className="size-3 text-muted-foreground" />
        </button>
        <button
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm transition-colors hover:border-foreground/30",
            hasConnection ? "bg-card" : "border-amber-500/40 bg-amber-500/5",
          )}
          onClick={onOpenSettings}
          type="button"
        >
          <KeyRoundIcon className="size-3 text-muted-foreground" />
          {hasConnection ? t("connectionReady") : t("needsKey")}
          <ArrowUpRightIcon className="size-3 text-muted-foreground" />
        </button>
      </div>

      {!hasConnection ? (
        <button
          className="flex max-w-xl items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/8 px-3.5 py-2.5 text-left text-xs text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-200"
          onClick={onOpenSettings}
          type="button"
        >
          <KeyRoundIcon className="size-3.5 shrink-0" />
          <span>{t("demoHint")}</span>
          <span className="shrink-0 font-semibold underline underline-offset-2">
            {t("connectNow")} →
          </span>
        </button>
      ) : null}

      <div className="w-full max-w-2xl space-y-2.5 text-left">
        <p className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
          {t("startWith")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(({ key, icon: Icon }) => (
            <button
              className="group flex items-center gap-3 rounded-xl border bg-card/70 px-3.5 py-3 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md"
              key={key}
              onClick={() => choose(t(key))}
              type="button"
            >
              <Icon className="size-4 shrink-0 text-indigo-500" />
              <span className="min-w-0 flex-1 truncate">{t(key)}</span>
              <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/80">{t("poweredBy")} · {t("shortcutHint")}</p>
    </div>
  );
}
