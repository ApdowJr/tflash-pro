"use client";

import {
  CheckIcon,
  ChevronDownIcon,
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
import { providerConnectionExpired } from "@/lib/providers/connection-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAppSettings } from "./app-settings";

export function ModelBrowser({
  onPick,
  onConnectRequest,
  className,
}: {
  readonly onPick?: () => void;
  readonly onConnectRequest?: (providerId: string) => void;
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

  const expired = providerConnectionExpired(settings.connections[provider.id]);
  const needsKey = expired || (provider.requiresKey && !isConnected(provider.id));

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="relative">
          <label className="sr-only" htmlFor="model-provider">{t("provider")}</label>
          <select
            className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="model-provider"
            onChange={(event) => { setProviderId(event.target.value); setQuery(""); }}
            value={providerId}
          >
            {PROVIDERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{isConnected(item.id) ? ` · ${t("connected")}` : ""}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("searchModels")}
            className="pr-3 pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModels")}
            type="search"
            value={query}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
        {state.loading ? (
          <span className="inline-flex items-center gap-1"><Loader2Icon className="size-3 animate-spin" /> {t("refresh")}</span>
        ) : (
          <span>{state.source === "live" ? t("liveModels") : t("staticModels")} · {models.length} {t("modelsFound")}</span>
        )}
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

      {!state.loading && state.source === "static" ? <p className="text-xs text-muted-foreground">{t("modelStaticUnverified")}</p> : null}

      {needsKey ? (
        <button
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-brand/35 bg-brand/8 px-3 py-2 text-left text-[12px] text-foreground/90 transition-colors hover:bg-brand/14"
          onClick={() => onConnectRequest?.(provider.id)}
          type="button"
        >
          <KeyRoundIcon className="size-3.5 shrink-0" />
          <span>{expired ? t("providerExpired") : t("needsKey")}</span>
          <span className="ml-auto font-medium underline underline-offset-2">{t("connect")} →</span>
        </button>
      ) : null}

      {state.error ? (
        <p className="rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground text-xs" role="status">
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
                aria-pressed={active}
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
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] leading-tight text-muted-foreground sm:flex-row sm:items-center sm:gap-1.5 sm:pt-0.5">
                  {formatContext(model.contextWindow) !== "—" ? (
                    <span>{formatContext(model.contextWindow)}</span>
                  ) : null}
                  {price ? (
                    <span className="rounded bg-muted px-1 py-0.5">
                      {price} {t("input")}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
