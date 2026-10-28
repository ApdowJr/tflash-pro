"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  CopyIcon,
  CreditCardIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GitBranchIcon,
  KeyRoundIcon,
  ListChecksIcon,
  Loader2Icon,
  MailIcon,
  ShieldCheckIcon,
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

type Status = IntegrationsStatusResponse["integrations"][number];

function usableRecord(record: IntegrationTokenRecord | undefined): boolean {
  if (!record || typeof record.token !== "string" || !record.token.startsWith("v1.")) return false;
  const now = Date.now();
  return (!record.expiresAt || record.expiresAt > now) &&
    (!record.tokenExpiresAt || record.tokenExpiresAt > now);
}

/** Maps the `?oauth=` code from the callback route onto UI copy. */
function oauthErrorKey(code: string) {
  switch (code) {
    case "denied":
      return "oauthDenied" as const;
    case "state":
      return "oauthState" as const;
    case "exchange":
      return "oauthExchange" as const;
    case "unconfigured":
    case "misconfigured":
      return "oauthUnconfigured_error" as const;
    default:
      return "oauthError" as const;
  }
}

/**
 * Connections: every external tool the agent can reach, how it authenticates,
 * and what it is allowed to do without asking.
 *
 * The primary path is a real OAuth grant — the developer lands on the
 * provider's consent screen and comes back connected. Pasting a token is the
 * fallback, not the expectation.
 */
export function ConnectionsPanel({ className }: { readonly className?: string }) {
  const { t, settings, disconnectIntegration, oauthError, oauthJustConnected, clearOAuthNotice } =
    useAppSettings();
  const [statuses, setStatuses] = useState<Readonly<Record<string, Status>>>({});
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
        const next: Record<string, Status> = {};
        for (const item of payload.integrations) next[item.id] = item;
        setStatuses(next);
      } catch {
        // Offline: the catalog still renders, just without live status.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Land with the connection that just finished open, so "connected" is visible.
  useEffect(() => {
    if (oauthJustConnected) setExpanded(oauthJustConnected);
  }, [oauthJustConnected]);

  const groups = useMemo(
    () =>
      INTEGRATION_CATEGORIES.map((category) => ({
        ...category,
        items: INTEGRATIONS.filter((integration) => integration.category === category.id),
      })).filter((group) => group.items.length > 0),
    [],
  );

  const configuredCount = INTEGRATIONS.filter(
    (integration) =>
      usableRecord(settings.integrationTokens[integration.id]) ||
      statuses[integration.id]?.configured === true,
  ).length;

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied(undefined), 1500);
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {oauthError ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2"
          role="alert"
        >
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="flex-1 text-[12px] text-destructive leading-snug">
            {t(oauthErrorKey(oauthError))}
          </p>
          <button
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={clearOAuthNotice}
            type="button"
          >
            {t("dismiss")}
          </button>
        </div>
      ) : null}

      {oauthJustConnected ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="flex-1 text-[12px] text-emerald-700 leading-snug dark:text-emerald-300">
            {t("oauthConnected")}
          </p>
          <button
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={clearOAuthNotice}
            type="button"
          >
            {t("dismiss")}
          </button>
        </div>
      ) : null}

      <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-3">
        <div className="flex items-start gap-2">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-pretty text-[12px] text-muted-foreground leading-relaxed">
            {t("connectionsIntro")}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {configuredCount}/{INTEGRATIONS.length} {t("connectionsActive")}
        </p>
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
                onDisconnect={() => disconnectIntegration(integration.id)}
                onToggle={() =>
                  setExpanded((current) =>
                    current === integration.id ? null : integration.id,
                  )
                }
                record={settings.integrationTokens[integration.id]}
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
  record,
  isOpen,
  copied,
  onToggle,
  onCopy,
  onDisconnect,
}: {
  readonly integration: IntegrationInfo;
  readonly status?: Status;
  readonly record?: IntegrationTokenRecord;
  readonly isOpen: boolean;
  readonly copied?: string;
  readonly onToggle: () => void;
  readonly onCopy: (value: string) => void;
  readonly onDisconnect: () => void;
}) {
  const { t, settings, connectIntegration } = useAppSettings();
  const Icon = ICONS[integration.id];
  const browserConnected = usableRecord(record);
  const serverConfigured = status?.configured ?? false;
  const connected = browserConnected || serverConfigured;
  const mode = status?.mode ?? "none";
  // Optimistic until the status call lands: an unconfigured provider bounces
  // back with `?oauth=unconfigured`, which the panel turns into a clear banner.
  const oauthReady = status?.oauthAvailable ?? integration.oauth !== undefined;

  const [redirecting, setRedirecting] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [canForce, setCanForce] = useState(false);

  const startOAuth = () => {
    setRedirecting(true);
    window.location.assign(`/api/integrations/oauth/start?id=${encodeURIComponent(integration.id)}`);
  };

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
      connectIntegration(integration.id, {
        token: payload.token,
        label: payload.verified ? t("tokenConnected") : t("tokenSaved"),
        connectedAt: Date.now(),
        source: "token",
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

  const expiresLabel =
    record?.expiresAt && !record.refreshable
      ? new Date(record.expiresAt).toLocaleDateString(settings.language, {
          month: "short",
          day: "numeric",
        })
      : undefined;

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
                : connected || mode === "project-connect"
                  ? t(accessLabelKey(mode))
                  : t("integrationNotConnected")}
            </span>
            <span className="rounded-full border border-border/70 px-1.5 py-0 text-[10px] text-muted-foreground">
              {t("approvalAlways")}
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

          {browserConnected && record ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
              <CheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium text-[11px] text-emerald-800 dark:text-emerald-200">
                {record.label}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {record.refreshable
                  ? t("renewsAutomatically")
                  : expiresLabel
                    ? `${t("expiresOn")} ${expiresLabel}`
                    : ""}
              </span>
              <Button
                className="ml-auto h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={onDisconnect}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2Icon className="size-3" />
                {t("tokenDisconnect")}
              </Button>
            </div>
          ) : null}

          {!browserConnected && record ? (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-[11px] text-muted-foreground">
              <span>{t("integrationExpired")}</span>
              <Button className="ml-auto h-7 px-2 text-[11px]" onClick={onDisconnect} size="sm" type="button" variant="ghost">
                {t("tokenDisconnect")}
              </Button>
            </div>
          ) : null}

          {!browserConnected && integration.oauth ? (
            oauthReady ? (
              <div className="space-y-1.5">
                <Button
                  className="h-8 gap-1.5 text-[12px]"
                  disabled={redirecting}
                  onClick={startOAuth}
                  size="sm"
                  type="button"
                >
                  {redirecting ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <ShieldCheckIcon className="size-3.5" />
                  )}
                  {t("oauthContinue")} {integration.name}
                  {redirecting ? null : <ArrowRightIcon className="size-3.5" />}
                </Button>
                <p className="text-pretty text-[11px] text-muted-foreground leading-snug">
                  <span className="font-medium text-foreground/80">{t("oauthAccessTitle")}: </span>
                  {integration.oauth.access[settings.language]}
                </p>
                <p className="text-pretty text-[10px] text-muted-foreground/80 leading-snug">
                  {t("oauthConsentNote")}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2">
                <p className="text-pretty text-[11px] text-muted-foreground leading-snug">
                  {t("oauthUnconfigured")}
                </p>
                <div className="flex flex-wrap gap-1">
                  {(status?.oauthEnvKeys ?? []).map((key) => (
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 hover:border-foreground/20"
                      key={key}
                      onClick={() => onCopy(key)}
                      type="button"
                    >
                      {key}
                      {copied === key ? (
                        <CheckIcon className="size-2.5" />
                      ) : (
                        <CopyIcon className="size-2.5 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
                {status?.oauthSetupUrl ? (
                  <a
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    href={status.oauthSetupUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLinkIcon className="size-3" />
                    {t("oauthSetupLink")}
                  </a>
                ) : null}
              </div>
            )
          ) : null}

          {!browserConnected && !integration.oauth ? (
            <p className="text-pretty text-[11px] text-muted-foreground leading-snug">
              {t("tokenOnlyNote")}
            </p>
          ) : null}

          {!browserConnected ? (
            <div className="space-y-2 border-t border-border/60 pt-2.5">
              {showTokenForm || !oauthReady ? (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground">
                    <KeyRoundIcon className="size-3" />
                    {t("connectWithToken")}
                  </p>
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
              ) : (
                <button
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => setShowTokenForm(true)}
                  type="button"
                >
                  {t("useTokenInstead")}
                </button>
              )}
            </div>
          ) : null}

          {browserConnected ? null : (
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
          )}

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

function accessLabelKey(mode: Status["mode"]) {
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
