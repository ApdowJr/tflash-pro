"use client";

import {
  CheckCircle2Icon,
  Settings2Icon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LayersIcon,
  Loader2Icon,
  LockKeyholeIcon,
  BoxesIcon,
  PaletteIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { PROVIDERS, type ProviderInfo } from "@/lib/providers/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LANGUAGES, type Language } from "./i18n";
import { ConnectionsPanel } from "./connections-panel";
import { ModelBrowser } from "./model-browser";
import { PERSONAS } from "./personas";
import { ProviderBadge, StatusDot } from "./provider-badge";
import { useAppSettings, type Theme } from "./app-settings";

type Tab = "providers" | "connections" | "models" | "preferences";

type ProviderStatus = {
  readonly kind: "idle" | "pending" | "ok" | "error";
  readonly message?: string;
  readonly canForce?: boolean;
};

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "providers",
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialTab?: Tab;
}) {
  const { settings, t, connect, disconnect, isConnected, envConfigured, refreshStatus, loadModels, update, clearChats } =
    useAppSettings();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [expanded, setExpanded] = useState<string | null>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});

  const setStatus = (id: string, status: ProviderStatus) =>
    setStatuses((current) => ({ ...current, [id]: status }));

  // Keys are per-provider: never carry one provider's input into another card.
  const toggleProvider = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    setApiKey("");
    setBaseURL("");
    setShowKey(false);
  };

  async function testProvider(provider: ProviderInfo) {
    setStatus(provider.id, { kind: "pending", message: t("testing") });
    try {
      const response = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey,
          baseURL: provider.customBaseURL ? baseURL : undefined,
          token: settings.connections[provider.id]?.token,
        }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      setStatus(provider.id, {
        kind: response.ok ? "ok" : "error",
        message: payload.message ?? payload.error ?? (response.ok ? "OK" : "Failed"),
      });
    } catch (error) {
      setStatus(provider.id, {
        kind: "error",
        message: error instanceof Error ? error.message : t("connectionFailed"),
      });
    }
  }

  async function connectProvider(provider: ProviderInfo, force = false) {
    setStatus(provider.id, { kind: "pending", message: t("connecting") });
    try {
      const response = await fetch("/api/providers/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey,
          baseURL: provider.customBaseURL ? baseURL : undefined,
          force,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
        token?: string;
        modelCount?: number;
      };
      if (!response.ok) {
        setStatus(provider.id, {
          kind: "error",
          message: payload.message ?? payload.error ?? t("connectionFailed"),
          canForce: !force,
        });
        return;
      }
      connect(provider.id, {
        ...(payload.token ? { token: payload.token } : {}),
        label: payload.message ?? t("connected"),
        connectedAt: Date.now(),
        ...(provider.customBaseURL && baseURL ? { baseURL } : {}),
        ...(payload.modelCount !== undefined ? { modelCount: payload.modelCount } : {}),
        source: payload.token ? "browser" : envConfigured[provider.id] ? "server" : "keyless",
      });
      setStatus(provider.id, { kind: "ok", message: payload.message ?? t("connected") });
      setApiKey("");
      void refreshStatus();
      void loadModels(provider.id, true);
    } catch (error) {
      setStatus(provider.id, {
        kind: "error",
        message: error instanceof Error ? error.message : t("connectionFailed"),
      });
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof PlugZapIcon }[] = [
    { id: "providers", label: t("providers"), icon: PlugZapIcon },
    { id: "connections", label: t("connections"), icon: BoxesIcon },
    { id: "models", label: t("models"), icon: LayersIcon },
    { id: "preferences", label: t("preferences"), icon: SlidersHorizontalIcon },
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(88dvh,760px)] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 max-sm:h-[calc(100dvh-1.25rem)] max-sm:max-w-[calc(100%-1rem)]">
        <DialogHeader className="shrink-0 gap-1 border-b border-border/70 px-4 py-3.5 pr-12 sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2 font-semibold text-[15px] tracking-[-0.01em]">
            <Settings2Icon className="size-4 text-muted-foreground" />
            {t("settings")}
          </DialogTitle>
          <DialogDescription className="text-pretty text-muted-foreground text-xs">
            {t("providerHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav className="tflash-scroll flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:p-3">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  tab === id
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                key={id}
                onClick={() => setTab(id)}
                type="button"
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
            <div className="mt-auto hidden px-3 pt-4 text-[10px] text-muted-foreground sm:block">
              <ShieldCheckIcon className="mb-1 size-4" />
              {t("secureNote")}
            </div>
          </nav>

          <div className="tflash-scroll tf-safe-bottom min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {tab === "providers" ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5 text-muted-foreground text-xs">
                  <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span className="text-pretty">{t("openRouterTip")}</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {PROVIDERS.map((provider) => {
                    const connected = isConnected(provider.id);
                    const isOpen = expanded === provider.id;
                    const status = statuses[provider.id] ?? { kind: "idle" as const };
                    const connection = settings.connections[provider.id];
                    return (
                      <div
                        className={cn(
                          "rounded-xl border bg-card transition-shadow",
                          isOpen && "border-foreground/20 shadow-sm",
                        )}
                        key={provider.id}
                      >
                        <button
                          className="flex w-full items-start gap-3 p-3 text-left"
                          onClick={() => toggleProvider(provider.id)}
                          type="button"
                        >
                          <ProviderBadge provider={provider} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-sm">{provider.name}</span>
                              {provider.featured ? (
                                <Badge
                                  className="rounded-full border-border/70 px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                                  variant="outline"
                                >
                                  Popular
                                </Badge>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-muted-foreground text-xs">
                              {provider.tagline}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                            <StatusDot active={connected} />
                            <span className="hidden sm:inline">
                              {connected ? t("connected") : t("notConnected")}
                            </span>
                          </span>
                        </button>

                        {isOpen ? (
                          <div className="space-y-2.5 border-t px-3 pt-3 pb-3">
                            {provider.kind === "gateway" ? (
                              <p className="rounded-md bg-muted/60 px-2.5 py-2 text-muted-foreground text-xs">
                                {t("gatewayHint")}
                              </p>
                            ) : (
                              <>
                                {provider.requiresKey ? (
                                  <div className="space-y-1.5">
                                    <label
                                      className="flex items-center gap-1.5 font-medium text-xs"
                                      htmlFor={`key-${provider.id}`}
                                    >
                                      <KeyRoundIcon className="size-3" />
                                      {t("apiKey")}
                                      {provider.envKey ? (
                                        <span className="font-mono font-normal text-[10px] text-muted-foreground">
                                          ({provider.envKey})
                                        </span>
                                      ) : null}
                                    </label>
                                    <div className="relative">
                                      <Input
                                        autoComplete="off"
                                        className="pr-9 font-mono text-xs"
                                        id={`key-${provider.id}`}
                                        onChange={(event) => setApiKey(event.target.value)}
                                        placeholder={t("apiKeyPlaceholder")}
                                        type={showKey ? "text" : "password"}
                                        value={apiKey}
                                      />
                                      <button
                                        aria-label={showKey ? "Hide key" : "Show key"}
                                        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        onClick={() => setShowKey((value) => !value)}
                                        type="button"
                                      >
                                        {showKey ? (
                                          <EyeOffIcon className="size-4" />
                                        ) : (
                                          <EyeIcon className="size-4" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                ) : null}

                                {provider.customBaseURL ? (
                                  <div className="space-y-1.5">
                                    <label
                                      className="block font-medium text-xs"
                                      htmlFor={`url-${provider.id}`}
                                    >
                                      {t("baseURL")}
                                    </label>
                                    <Input
                                      className="font-mono text-xs"
                                      id={`url-${provider.id}`}
                                      onChange={(event) => setBaseURL(event.target.value)}
                                      placeholder={provider.baseURL}
                                      value={baseURL}
                                    />
                                  </div>
                                ) : null}

                                {status.message ? (
                                  <p
                                    className={cn(
                                      "flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs",
                                      status.kind === "ok"
                                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                        : status.kind === "error"
                                          ? "bg-destructive/10 text-destructive"
                                          : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {status.kind === "pending" ? (
                                      <Loader2Icon className="mt-0.5 size-3 animate-spin" />
                                    ) : status.kind === "ok" ? (
                                      <CheckCircle2Icon className="mt-0.5 size-3" />
                                    ) : null}
                                    {status.message}
                                  </p>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Button
                                    className="h-8 text-xs"
                                    disabled={status.kind === "pending"}
                                    onClick={() => void testProvider(provider)}
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                  >
                                    <RefreshCwIcon className="size-3" />
                                    {t("test")}
                                  </Button>
                                  <Button
                                    className="h-8 text-xs"
                                    disabled={status.kind === "pending"}
                                    onClick={() => void connectProvider(provider)}
                                    size="sm"
                                    type="button"
                                  >
                                    <PlugZapIcon className="size-3" />
                                    {connected ? t("reset") : t("connect")}
                                  </Button>
                                  {status.canForce ? (
                                    <Button
                                      className="h-8 text-xs"
                                      onClick={() => void connectProvider(provider, true)}
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      {t("forceConnect")}
                                    </Button>
                                  ) : null}
                                  {connection ? (
                                    <Button
                                      className="h-8 text-xs"
                                      onClick={() => {
                                        disconnect(provider.id);
                                        setStatus(provider.id, { kind: "idle" });
                                      }}
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      <Trash2Icon className="size-3" />
                                      {t("disconnect")}
                                    </Button>
                                  ) : null}
                                </div>

                                <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] text-muted-foreground">
                                  <a
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    href={provider.keyUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <ExternalLinkIcon className="size-3" />
                                    {t("getKey")}
                                  </a>
                                  <a
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                    href={provider.docsUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <ExternalLinkIcon className="size-3" />
                                    {t("docs")}
                                  </a>
                                  {envConfigured[provider.id] ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                      <LockKeyholeIcon className="size-3" />
                                      {t("serverKey")}
                                    </span>
                                  ) : null}
                                </div>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-muted-foreground text-xs">
                  <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
                  {t("keyStoredNote")}
                </p>
              </div>
            ) : null}

            {tab === "connections" ? <ConnectionsPanel /> : null}

            {tab === "models" ? (
              <ModelBrowser
                className="min-h-[420px]"
                onConnectRequest={() => setTab("providers")}
              />
            ) : null}

            {tab === "preferences" ? (
              <div className="space-y-5">
                <PreferenceRow icon={PaletteIcon} label={t("theme")}>
                  <div className="flex gap-1.5">
                    {(["light", "dark", "system"] as Theme[]).map((theme) => (
                      <Button
                        className="h-8 text-xs"
                        key={theme}
                        onClick={() => update({ theme })}
                        size="sm"
                        type="button"
                        variant={settings.theme === theme ? "default" : "outline"}
                      >
                        {t(theme)}
                      </Button>
                    ))}
                  </div>
                </PreferenceRow>

                <PreferenceRow icon={SparklesIcon} label={t("language")}>
                  <div className="flex gap-1.5">
                    {LANGUAGES.map((language) => (
                      <Button
                        className="h-8 text-xs"
                        key={language.id}
                        onClick={() => update({ language: language.id as Language })}
                        size="sm"
                        type="button"
                        variant={settings.language === language.id ? "default" : "outline"}
                      >
                        {language.label}
                      </Button>
                    ))}
                  </div>
                </PreferenceRow>

                <div className="space-y-2">
                  <p className="font-medium text-[13px]">{t("persona")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PERSONAS.map((persona) => (
                      <button
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors hover:border-foreground/30",
                          settings.persona === persona.id && "border-foreground/30 bg-muted/60",
                        )}
                        key={persona.id}
                        onClick={() => update({ persona: persona.id })}
                        type="button"
                      >
                        <span className="flex items-center justify-between font-medium text-sm">
                          {persona.label[settings.language]}
                          {settings.persona === persona.id ? (
                            <CheckCircle2Icon className="size-4 text-emerald-600" />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-muted-foreground text-xs">
                          {persona.hint[settings.language]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <p className="font-medium text-[13px]">{t("shortcuts")}</p>
                  <p className="text-muted-foreground text-xs">{t("shortcutHint")}</p>
                  <Button
                    className="h-8 text-xs"
                    onClick={() => {
                      clearChats();
                      setStatus("local", { kind: "ok", message: "Local chat history cleared." });
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trash2Icon className="size-3" />
                    {t("clearData")}
                  </Button>
                  {statuses.local?.message ? (
                    <p className="text-emerald-600 text-xs dark:text-emerald-400">
                      {statuses.local.message}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreferenceRow({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: typeof PaletteIcon;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
      <p className="flex items-center gap-2 font-medium text-[13px]">
        <Icon className="size-4 text-muted-foreground" />
        {label}
      </p>
      {children}
    </div>
  );
}

