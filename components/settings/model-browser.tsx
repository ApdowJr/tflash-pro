"use client";

import {
  CheckIcon,
  EyeIcon,
  KeyRoundIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PROVIDERS,
  formatContext,
  formatPrice,
  getProvider,
} from "@/lib/providers/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ProviderBadge, StatusDot } from "./provider-badge";
import { useAppSettings } from "./app-settings";

export function ModelBrowser({
  onPick,
  onConnectRequest,
  className,
}: {
  readonly onPick?: () => void;
  readonly onConnectRequest?: () => void;
  readonly className?: string;
}) {
  const { settings, t, modelsFor, modelsStateFor, loadModels, setModel, isConnected, selection } =
    useAppSettings();
  const [providerId, setProviderId] = useState(settings.providerId);
  const [query, setQuery] = useState("");
  const provider = getProvider(providerId) ?? PROVIDERS[0]!;

  useEffect(() => {
    void loadModels(providerId);
    // Reload when a key is added so a private catalog becomes visible.
  }, [providerId, loadModels, settings.connections]);

  const state = modelsStateFor(providerId);
  const models = modelsFor(providerId);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models.slice(0, 120);
    return models
      .filter(
        (model) =>
          model.id.toLowerCase().includes(needle) ||
          (model.name ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 120);
  }, [models, query]);

  const needsKey = provider.requiresKey && !isConnected(provider.id);

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="tflash-scroll flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
        {PROVIDERS.map((item) => {
          const active = item.id === providerId;
          return (
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors",
                active
                  ? "border-transparent bg-foreground text-background"
                  : "border-border/70 bg-card/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
              key={item.id}
              onClick={() => setProviderId(item.id)}
              type="button"
            >
              <StatusDot active={isConnected(item.id)} />
              <span className="font-medium">{item.name}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pr-3 pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchModels")}
          value={query}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          <ProviderBadge provider={provider} size="sm" />
          <span className="font-medium text-foreground">{provider.name}</span>
          <span aria-hidden="true">·</span>
          {state.loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2Icon className="size-3 animate-spin" /> {t("refresh")}
            </span>
          ) : (
            <>
              {state.source === "live" ? t("liveModels") : t("staticModels")} · {models.length}{" "}
              {t("modelsFound")}
            </>
          )}
        </span>
        <Button
          className="h-7 px-2 text-xs"
          disabled={state.loading}
          onClick={() => void loadModels(providerId, true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon className={cn("size-3", state.loading && "animate-spin")} />
          {t("refresh")}
        </Button>
      </div>

      {needsKey ? (
        <button
          className="flex items-center gap-2 rounded-lg border border-brand/35 bg-brand/8 px-3 py-2 text-left text-[12px] text-foreground/90 transition-colors hover:bg-brand/14"
          onClick={() => onConnectRequest?.()}
          type="button"
        >
          <KeyRoundIcon className="size-3.5 shrink-0" />
          <span>{t("needsKey")}</span>
          <span className="ml-auto font-medium underline underline-offset-2">{t("connect")} →</span>
        </button>
      ) : null}

      {state.error ? (
        <p className="rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground text-xs">
          {state.error}
        </p>
      ) : null}

      <div className="tflash-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground text-sm">{t("noModels")}</p>
        ) : (
          filtered.map((model) => {
            const active = selection.providerId === providerId && selection.modelId === model.id;
            const price = formatPrice(model.inputPrice);
            return (
              <button
                className={cn(
                  "group flex w-full items-start gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted/60",
                  active && "border-border bg-muted/70",
                )}
                key={model.id}
                onClick={() => {
                  setModel(providerId, model.id, model.contextWindow);
                  onPick?.();
                }}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-sm">{model.name ?? model.id}</span>
                    {model.free ? (
                      <Badge className="px-1 py-0 text-[10px]" variant="secondary">
                        {t("free")}
                      </Badge>
                    ) : null}
                    {model.vision ? <EyeIcon className="size-3 text-muted-foreground" /> : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {model.id}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                  {formatContext(model.contextWindow) !== "—" ? (
                    <span>{formatContext(model.contextWindow)}</span>
                  ) : null}
                  {price ? (
                    <span className="rounded bg-muted px-1 py-0.5">
                      {price} {t("input")}
                    </span>
                  ) : null}
                  {active ? <CheckIcon className="size-3.5 text-foreground" /> : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
