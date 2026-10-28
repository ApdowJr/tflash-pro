"use client";

import {
  ActivityIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  CopyIcon,
  CreditCardIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  ListChecksIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  MailIcon,
  ShieldCheckIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IntegrationsStatusResponse } from "@/app/api/integrations/route";
import {
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  type IntegrationId,
  type IntegrationInfo,
} from "@/lib/integrations/catalog";
import type { IntegrationTokenRecord } from "./app-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAppSettings } from "./app-settings";

const ICONS: Record<IntegrationId, typeof DatabaseIcon> = {
  github: GitBranchIcon,
  linear: ListChecksIcon,
  notion: BookOpenIcon,
  sentry: TriangleAlertIcon,
  supabase: DatabaseIcon,
  neon: DatabaseIcon,
  vercel: CloudIcon,
  posthog: ActivityIcon,
  stripe: CreditCardIcon,
  resend: MailIcon,
};

type ServerStatus = {
  readonly connected: boolean;
  readonly mode: "connect" | "token" | "project-connect" | "none";
};

const CONNECT_COMMAND = "vercel connect create github --name t-flash && vercel env pull";

/**
 * Connections: every external tool the agent can reach, how it authenticates,
 * and what it is allowed to do without asking. Deliberately plain — this is a
 * settings page, not a marketplace.
 */
export function ConnectionsPanel({ className }: { readonly className?: string }) {
  const { t, settings, connectIntegration, disconnectIntegration } = useAppSettings();
  const [statuses, setStatuses] = useState<Readonly<Record<string, ServerStatus>>>({});
  const [connectAvailable, setConnectAvailable] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/integrations", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as IntegrationsStatusResponse;
        if (cancelled) return;
        const next: Record<string, ServerStatus> = {};
        for (const item of payload.integrations) {
          next[item.id] = { connected: item.connected, mode: item.mode };
        }
        setStatuses(next);
        setConnectAvailable(payload.integrations.some((item) => item.connectAvailable));
      } catch {
        // Offline: the catalog still renders, just without live status.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(
    () =>
      INTEGRATION_CATEGORIES.map((category) => ({
        ...category,
        items: INTEGRATIONS.filter((integration) => integration.category === category.id),
      })).filter((group) => group.items.length > 0),
    [],
  );

  const connectedCount =
    INTEGRATIONS.filter(
      (integration) =>
        Boolean(settings.integrationTokens[integration.id]) ||
        statuses[integration.id]?.connected === true,
    ).length;

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied(undefined), 1500);
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-3">
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-pretty text-[12px] text-muted-foreground leading-relaxed">
            {t("connectionsIntro")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
              connectAvailable
                ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
                : "border-border/70 bg-card text-muted-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                connectAvailable ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {connectAvailable ? t("connectReady") : t("connectUnavailable")}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {connectedCount}/{INTEGRATIONS.length} {t("connectionsActive")}
          </span>
        </div>
        {connectAvailable ? null : (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5">
            <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {CONNECT_COMMAND}
            </code>
            <Button
              aria-label={t("copy")}
              className="size-6 shrink-0 text-muted-foreground"
              onClick={() => copy(CONNECT_COMMAND)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {copied === CONNECT_COMMAND ? (
                <CheckIcon className="size-3" />
              ) : (
                <CopyIcon className="size-3" />
              )}
            </Button>
          </div>
        )}
      </div>

      {groups.map((group) => (
        <section className="space-y-2" key={group.id}>
          <h3 className="px-1 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
            {group.label[settings.language]}
          </h3>
          <div className="space-y-1.5">
            {group.items.map((integration) => (
              <ConnectionRow
                copied={copied}
                integration={integration}
                isOpen={expanded === integration.id}
                key={integration.id}
                onCopy={copy}
                onToggle={() =>
                  setExpanded((current) =>
                    current === integration.id ? null : integration.id,
                  )
                }
                onDisconnect={() => disconnectIntegration(integration.id)}
                onToken={(record) => connectIntegration(integration.id, record)}
                sealedToken={settings.integrationTokens[integration.id]?.token}
                status={statuses[integration.id]}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/80">
        {t("connectionsFootNote")}
      </p>
    </div>
  );
}

function ConnectionRow({
  integration,
  status,
  sealedToken,
  isOpen,
  copied,
  onToggle,
  onCopy,
  onToken,
  onDisconnect,
}: {
  readonly integration: IntegrationInfo;
  readonly status?: ServerStatus;
  readonly sealedToken?: string;
  readonly isOpen: boolean;
  readonly copied?: string;
  readonly onToggle: () => void;
  readonly onCopy: (value: string) => void;
  readonly onToken: (record: IntegrationTokenRecord) => void;
  readonly onDisconnect: () => void;
}) {
  const { t, settings } = useAppSettings();
  const Icon = ICONS[integration.id];
  const browserConnected = Boolean(sealedToken);
  const connected = browserConnected || (status?.connected ?? false);
  const mode = status?.mode ?? "none";
  const [tokenDraft, setTokenDraft] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [canForce, setCanForce] = useState(false);

  const saveToken = async (force = false) => {
    const token = tokenDraft.trim();
    if (token.length === 0) return;
    setPending(true);
    setMessage(undefined);
    setCanForce(false);
    try {
      const response = await fetch("/api/integrations/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ integrationId: integration.id, token, force }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        token?: string;
        expiresAt?: number;
        verified?: boolean;
        canForce?: boolean;
      };
      if (!response.ok || !payload.ok || !payload.token) {
        setCanForce(payload.canForce === true);
        setMessage({ kind: "error", text: payload.message ?? t("tokenInvalid") });
        return;
      }
      onToken({
        token: payload.token,
        label: payload.verified ? t("tokenConnected") : t("tokenSaved"),
        connectedAt: Date.now(),
        ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
      });
      setTokenDraft("");
      setMessage({
        kind: "ok",
        text: payload.verified ? t("tokenConnected") : t("tokenSaved"),
      });
    } catch {
      setMessage({ kind: "error", text: t("connectionFailed") });
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        isOpen ? "border-foreground/20" : "border-border/70",
      )}
    >
      <button
        aria-expanded={isOpen}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
        onClick={onToggle}
        type="button"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-[13px] text-foreground">{integration.name}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px]",
                connected
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {browserConnected
                ? t("integrationBrowser")
                : connected
                  ? t(accessLabelKey(mode))
                  : t("integrationNotConnected")}
            </span>
            <span className="rounded-full border border-border/70 px-1.5 py-0 text-[10px] text-muted-foreground">
              {t(approvalLabelKey(integration.access))}
            </span>
          </span>
          <span className="mt-0.5 block text-pretty text-muted-foreground text-[12px] leading-snug">
            {integration.summary[settings.language]}
          </span>
        </span>
        <ChevronDownIcon
          className={cn(
            "mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen ? (
        <div className="space-y-2.5 border-t border-border/70 px-3 pt-2.5 pb-3">
          <p className="text-pretty text-[12px] text-muted-foreground leading-relaxed">
            {integration.description}
          </p>
          {integration.note ? (
            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {integration.note[settings.language]}
            </p>
          ) : null}

          {integration.probe ? (
            <div className="space-y-2 border-t border-border/60 pt-2.5">
              <p className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground">
                <KeyRoundIcon className="size-3" />
                {t("connectWithToken")}
              </p>
              {sealedToken ? (
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                    {t("integrationBrowser")}
                  </p>
                  <Button
                    className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={onDisconnect}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2Icon className="size-3" />
                    {t("tokenDisconnect")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Input
                      autoComplete="off"
                      className="h-8 pr-9 font-mono text-[11px]"
                      onChange={(event) => setTokenDraft(event.target.value)}
                      placeholder={t("tokenPlaceholder")}
                      type={showToken ? "text" : "password"}
                      value={tokenDraft}
                    />
                    <button
                      aria-label={showToken ? t("hideToken") : t("showToken")}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowToken((value) => !value)}
                      type="button"
                    >
                      {showToken ? (
                        <EyeOffIcon className="size-3.5" />
                      ) : (
                        <EyeIcon className="size-3.5" />
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      className="h-7 text-[11px]"
                      disabled={pending || tokenDraft.trim().length === 0}
                      onClick={() => void saveToken()}
                      size="sm"
                      type="button"
                    >
                      {pending ? <Loader2Icon className="size-3 animate-spin" /> : null}
                      {pending ? t("checkingToken") : t("connect")}
                    </Button>
                    {canForce ? (
                      <Button
                        className="h-7 text-[11px]"
                        disabled={pending}
                        onClick={() => void saveToken(true)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("saveAnyway")}
                      </Button>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground/80">{t("tokenHint")}</span>
                  </div>
                </div>
              )}
              {message ? (
                <p
                  className={cn(
                    "text-[11px]",
                    message.kind === "ok"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-destructive",
                  )}
                  role={message.kind === "error" ? "alert" : undefined}
                >
                  {message.text}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1">
            <p className="font-medium text-[11px] text-muted-foreground">
              {t("integrationEnvTitle")}
            </p>
            {[...integration.tokenEnvKeys, integration.connectorEnvKey].map((key) => (
              <div
                className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1"
                key={key}
              >
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">
                  {key}
                </code>
                <button
                  aria-label={t("copy")}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onCopy(key)}
                  type="button"
                >
                  {copied === key ? (
                    <CheckIcon className="size-3" />
                  ) : (
                    <CopyIcon className="size-3" />
                  )}
                </button>
              </div>
            ))}
          </div>

          <a
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            href={integration.docsUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon className="size-3" />
            {t("docs")}
          </a>
        </div>
      ) : null}
    </div>
  );
}

function approvalLabelKey(access: IntegrationInfo["access"]) {
  switch (access) {
    case "read":
      return "approvalNever" as const;
    case "write":
      return "approvalOnce" as const;
    case "destructive":
      return "approvalAlways" as const;
  }
}

function accessLabelKey(mode: ServerStatus["mode"]) {
  switch (mode) {
    case "connect":
      return "integrationViaConnect" as const;
    case "project-connect":
      return "integrationViaProjectConnect" as const;
    case "token":
      return "integrationViaToken" as const;
    case "none":
    default:
      return "integrationNotConnected" as const;
  }
}
