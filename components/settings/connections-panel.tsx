"use client";

import {
  ActivityIcon, ArrowRightIcon, BookOpenIcon, CheckIcon, ChevronDownIcon,
  CloudIcon, CreditCardIcon, DatabaseIcon, ExternalLinkIcon, GitBranchIcon,
  ListChecksIcon, Loader2Icon, MailIcon, ShieldCheckIcon, TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IntegrationsStatusResponse } from "@/app/api/integrations/route";
import { INTEGRATION_CATEGORIES, INTEGRATIONS, type IntegrationId, type IntegrationInfo } from "@/lib/integrations/catalog";
import type { IntegrationTokenRecord } from "./app-settings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppSettings } from "./app-settings";

const ICONS: Record<IntegrationId, typeof DatabaseIcon> = {
  github: GitBranchIcon, linear: ListChecksIcon, notion: BookOpenIcon,
  sentry: TriangleAlertIcon, supabase: DatabaseIcon, neon: DatabaseIcon,
  vercel: CloudIcon, posthog: ActivityIcon, stripe: CreditCardIcon, resend: MailIcon,
};
type Status = IntegrationsStatusResponse["integrations"][number];

function usableRecord(record: IntegrationTokenRecord | undefined): boolean {
  if (!record || typeof record.token !== "string" || !record.token.startsWith("v1.")) return false;
  const now = Date.now();
  return (!record.expiresAt || record.expiresAt > now) && (!record.tokenExpiresAt || record.tokenExpiresAt > now);
}

function oauthErrorKey(code: string) {
  switch (code) {
    case "denied": return "oauthDenied" as const;
    case "state": return "oauthState" as const;
    case "exchange": return "oauthExchange" as const;
    case "unconfigured": return "oauthUnconfigured_error" as const;
    case "misconfigured": return "oauthStartFailed" as const;
    default: return "oauthError" as const;
  }
}

/** User-facing consent flow. Tokens and operator setup never belong in this form. */
export function ConnectionsPanel({ className }: { readonly className?: string }) {
  const { t, settings, disconnectIntegration, oauthError, oauthJustConnected, clearOAuthNotice } = useAppSettings();
  const [statuses, setStatuses] = useState<Readonly<Record<string, Status>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    const current = new URL(window.location.href);
    for (const key of ["oauth", "integration", "connected"]) current.searchParams.delete(key);
    setReturnTo(`${current.pathname}${current.search}`);
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch("/api/integrations", { cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const payload = await response.json() as IntegrationsStatusResponse;
        const next: Record<string, Status> = {};
        for (const item of payload.integrations) next[item.id] = item;
        if (!cancelled) setStatuses(next);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (oauthJustConnected) setExpanded(oauthJustConnected);
  }, [oauthJustConnected]);

  const groups = useMemo(() => INTEGRATION_CATEGORIES.map((category) => ({
    ...category, items: INTEGRATIONS.filter((item) => item.category === category.id),
  })), []);
  const connectedCount = INTEGRATIONS.filter((item) => usableRecord(settings.integrationTokens[item.id])).length;

  return (
    <div className={cn("space-y-4", className)}>
      {oauthError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs" role="alert">
          <p className="flex-1 text-destructive">{t(oauthErrorKey(oauthError))}</p>
          <button className="underline" onClick={clearOAuthNotice} type="button">{t("dismiss")}</button>
        </div>
      ) : null}
      {oauthJustConnected ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs" role="status">
          <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
          <p className="flex-1">{t("oauthConnected")}</p>
          <button className="underline" onClick={clearOAuthNotice} type="button">{t("dismiss")}</button>
        </div>
      ) : null}
      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
        <p className="flex-1">{t("connectionsIntro")}</p>
        <span className="shrink-0">{connectedCount}/{INTEGRATIONS.length} {t("connectionsActive")}</span>
      </div>
      {failed ? (
        <div className="flex items-center gap-2 px-1 text-xs" role="alert">
          <span className="flex-1">{t("connectionStatusFailed")}</span>
          <Button onClick={() => setAttempt((value) => value + 1)} size="sm" variant="outline">{t("refresh")}</Button>
        </div>
      ) : null}
      {groups.map((group) => (
        <section className="space-y-2" key={group.id}>
          <h3 className="px-1 text-xs font-medium text-muted-foreground">{group.label[settings.language]}</h3>
          {group.items.map((integration) => (
            <ConnectionRow
              integration={integration} status={statuses[integration.id]}
              record={settings.integrationTokens[integration.id]} loading={loading || failed}
              isOpen={expanded === integration.id} key={integration.id} returnTo={returnTo}
              onToggle={() => setExpanded((current) => current === integration.id ? null : integration.id)}
              onDisconnect={() => { disconnectIntegration(integration.id); clearOAuthNotice(); }}
            />
          ))}
        </section>
      ))}
      <p className="px-1 text-xs text-muted-foreground">{t("connectionsFootNote")}</p>
    </div>
  );
}

function ConnectionRow({ integration, status, record, loading, isOpen, returnTo, onToggle, onDisconnect }: {
  readonly integration: IntegrationInfo;
  readonly status?: Status;
  readonly record?: IntegrationTokenRecord;
  readonly loading: boolean;
  readonly isOpen: boolean;
  readonly returnTo: string;
  readonly onToggle: () => void;
  readonly onDisconnect: () => void;
}) {
  const { t, settings } = useAppSettings();
  const Icon = ICONS[integration.id];
  const connected = usableRecord(record);
  const oauthReady = !loading && status?.oauthAvailable === true;
  const [redirecting, setRedirecting] = useState(false);
  const params = new URLSearchParams({ id: integration.id, returnTo });

  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button aria-expanded={isOpen} aria-label={`${integration.name} ${t(connected ? "connected" : record ? "expired" : "notConnected")}`} className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onToggle} type="button">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{integration.name}</span>
            <span className={cn("block text-xs", connected ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
              {connected ? t(record?.source === "oauth" ? "connected" : "integrationBrowser") : record ? t("expired") : t("notConnected")}
            </span>
          </span>
          <ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground", isOpen && "rotate-180")} />
        </button>
        {connected ? (
          <Button className="h-8 text-xs" onClick={onDisconnect} size="sm" variant="outline">{t("disconnect")}</Button>
        ) : oauthReady ? (
          <Button asChild className="h-8 gap-1 text-xs" size="sm">
            <a aria-label={`${t("connect")} ${integration.name}`} aria-disabled={redirecting} href={`/api/integrations/oauth/start?${params}`} onClick={(event) => {
              if (redirecting) event.preventDefault();
              else setRedirecting(true);
            }}>
              {redirecting ? <Loader2Icon className="size-3 animate-spin" /> : <ArrowRightIcon className="size-3" />}
              {t(redirecting ? "connecting" : "connect")}
            </a>
          </Button>
        ) : (
          <span className="max-w-32 text-right text-[11px] text-muted-foreground">
            {loading ? t("checkingToken") : t("oauthSetupRequired")}
          </span>
        )}
      </div>
      {isOpen ? (
        <div className="space-y-2 border-t border-border/70 px-3 py-3 text-xs text-muted-foreground">
          <p>{integration.summary[settings.language]}</p>
          {integration.oauth ? <p><span className="font-medium text-foreground">{t("oauthAccessTitle")}: </span>{integration.oauth.access[settings.language]}</p> : null}
          {!connected ? <p>{oauthReady ? t("oauthConsentNote") : t("oauthUnconfigured")}</p> : null}
          {status?.configured ? <p>{t(status.mode === "connect" ? "integrationViaConnect" : "integrationViaToken")}</p> : null}
          {connected && record?.refreshable ? <p>{t("renewsAutomatically")}</p> : null}
          {connected && record?.expiresAt ? <p>{t("expiresOn")} {new Date(record.expiresAt).toLocaleDateString(settings.language)}</p> : null}
          <a className="inline-flex items-center gap-1 underline underline-offset-2" href={integration.docsUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon className="size-3" />{t("docs")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
