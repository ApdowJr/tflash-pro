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
import { fetchCatalogJson } from "@/lib/catalog-fetch";
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
    case "exchange": return "oauthExchangeUncertain" as const;
    case "exchange_uncertain": return "oauthExchangeUncertain" as const;
    case "registration_uncertain": return "oauthRegistrationUncertain" as const;
    case "unconfigured": return "oauthUnconfigured_error" as const;
    case "misconfigured": return "oauthStartFailed" as const;
    default: return "oauthError" as const;
  }
}

/** User-facing consent flow. Tokens and operator setup never belong in this form. */
export function ConnectionsPanel({ className }: { readonly className?: string }) {
  const { t, settings, accountId, accountKind, disconnectIntegration, oauthError, oauthJustConnected, clearOAuthNotice, oauthRenewalWarnings, oauthRenewalStale, oauthRenewalUnavailable, oauthHandoffWarnings, oauthHandoffUnavailable, reviewOAuthHandoff } = useAppSettings();
  const identity = `${accountKind}:${accountId}`;
  const [statusSnapshot, setStatusSnapshot] = useState<{ identity: string; statuses: Readonly<Record<string, Status>> }>({ identity: "", statuses: {} });
  const statuses = statusSnapshot.identity === identity ? statusSnapshot.statuses : {};
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
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const { response, data } = await fetchCatalogJson("/api/integrations", { cache: "no-store", signal: controller.signal,
          headers: { "x-tflash-expected-user-id": accountId, "x-tflash-expected-account-kind": accountKind } });
        if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Unavailable");
        const items = (data as { integrations?: unknown }).integrations;
        if (!Array.isArray(items) || items.length !== INTEGRATIONS.length) throw new Error("Invalid status");
        const next: Record<string, Status> = {};
        for (const item of items) {
          if (!item || typeof item !== "object" || typeof item.id !== "string" || !INTEGRATIONS.some((integration) => integration.id === item.id) || next[item.id] ||
            !["none", "token", "connect", "project-connect"].includes(item.mode) || typeof item.configured !== "boolean" || typeof item.oauthAvailable !== "boolean") throw new Error("Invalid status");
          next[item.id] = item as Status;
        }
        if (!cancelled) setStatusSnapshot({ identity, statuses: next });
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [attempt, accountId, accountKind, identity]);

  useEffect(() => {
    if (oauthJustConnected) setExpanded(oauthJustConnected);
  }, [oauthJustConnected]);

  const groups = useMemo(() => INTEGRATION_CATEGORIES.map((category) => ({
    ...category, items: INTEGRATIONS.filter((item) => item.category === category.id),
  })), []);
  const connectedCount = INTEGRATIONS.filter((item) => usableRecord(settings.integrationTokens[item.id]) &&
    !oauthRenewalWarnings.some((warning) => !warning.integrationId || warning.integrationId === item.id) && !oauthRenewalStale.includes(item.id)).length;

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
      {oauthHandoffUnavailable ? <p className="px-1 text-xs text-destructive" role="alert">{t("oauthHandoffUnavailable")}</p> : null}
      {oauthHandoffWarnings.map((warning) => <HandoffReview key={warning.key} warning={warning} review={reviewOAuthHandoff} />)}
      {oauthRenewalUnavailable ? <p className="px-1 text-xs text-destructive" role="alert">{t("oauthRenewalUnavailable")}</p> : null}
      {oauthRenewalWarnings.some((warning) => !warning.integrationId) ? <p className="px-1 text-xs text-destructive" role="alert">{t("oauthRenewalUnknown")}</p> : null}
      {groups.map((group) => (
        <section className="space-y-2" key={group.id}>
          <h3 className="px-1 text-xs font-medium text-muted-foreground">{group.label[settings.language]}</h3>
          {group.items.map((integration) => (
            <ConnectionRow
              integration={integration} status={failed || loading ? undefined : statuses[integration.id]}
              record={settings.integrationTokens[integration.id]} loading={loading || failed || statusSnapshot.identity !== identity}
              handoffHeld={oauthHandoffWarnings.length > 0 || oauthHandoffUnavailable}
              renewalUncertain={oauthRenewalWarnings.some((warning) => warning.integrationId === integration.id)} renewalStale={oauthRenewalStale.includes(integration.id)}
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

function HandoffReview({ warning, review }: { readonly warning: { readonly key: string; readonly integrationId?: string }; readonly review: (key: string) => Promise<boolean> }) {
  const { t } = useAppSettings();
  const [checked, setChecked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  return <div className="rounded-md border border-destructive/40 p-3 text-xs" role="alert">
    <p>{t("oauthHandoffUncertain")}</p>
    {warning.integrationId ? <p className="mt-1 font-medium">{INTEGRATIONS.find((item) => item.id === warning.integrationId)?.name ?? warning.integrationId}</p> : null}
    <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{t("oauthHandoffReviewLabel")}</label>
    <Button className="mt-2 h-auto min-h-10 whitespace-normal" disabled={!checked || pending} size="sm" variant="outline" type="button" onClick={() => {
      setPending(true);
      void review(warning.key).then((ok) => setFailed(!ok)).finally(() => setPending(false));
    }}>{t("oauthHandoffReviewButton")}</Button>
    {failed ? <p className="mt-1 text-destructive">{t("oauthHandoffReviewFailed")}</p> : null}
  </div>;
}

function ConnectionRow({ integration, status, record, loading, isOpen, returnTo, onToggle, onDisconnect, renewalUncertain, renewalStale, handoffHeld }: {
  readonly integration: IntegrationInfo;
  readonly status?: Status;
  readonly record?: IntegrationTokenRecord;
  readonly loading: boolean;
  readonly handoffHeld: boolean;
  readonly isOpen: boolean;
  readonly returnTo: string;
  readonly onToggle: () => void;
  readonly onDisconnect: () => void;
  readonly renewalUncertain: boolean;
  readonly renewalStale: boolean;
}) {
  const { t, settings, reviewOAuthRenewal } = useAppSettings();
  const Icon = ICONS[integration.id];
  const connected = usableRecord(record);
  const oauthReady = !loading && !handoffHeld && status?.oauthAvailable === true;
  const [redirecting, setRedirecting] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const params = new URLSearchParams({ id: integration.id, returnTo });

  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button aria-controls={`integration-panel-${integration.id}`} aria-expanded={isOpen} aria-label={`${integration.name} ${t(renewalUncertain || renewalStale ? "oauthRenewalReviewStatus" : connected ? "connected" : record ? "expired" : "notConnected")}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" id={`integration-toggle-${integration.id}`} onClick={onToggle} type="button">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{integration.name}</span>
            <span className={cn("block text-xs", connected && !renewalUncertain && !renewalStale ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
              {renewalUncertain || renewalStale ? t("oauthRenewalReviewStatus") : connected ? t(record?.source === "oauth" ? "connected" : "integrationBrowser") : record ? t("expired") : t("notConnected")}
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
            {handoffHeld ? t("oauthHandoffReviewStatus") : loading ? t("checkingToken") : t("oauthSetupRequired")}
          </span>
        )}
      </div>
      {renewalUncertain ? <div className="border-t border-destructive/30 px-3 py-2 text-xs" role="alert">
        <p>{t("oauthRenewalUncertain")}</p>
        <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />{t("oauthRenewalReviewLabel")}</label>
        <Button className="mt-2 h-auto min-h-10 whitespace-normal" size="sm" variant="outline" type="button" disabled={!reviewed || !record} onClick={() => void reviewOAuthRenewal(integration.id).then((ok) => { setReviewFailed(!ok); if (ok) setReviewed(false); })}>{t("oauthRenewalReviewButton")}</Button>
        {reviewFailed ? <p className="mt-1 text-destructive">{t("oauthRenewalReviewFailed")}</p> : null}
      </div> : renewalStale ? <p className="border-t px-3 py-2 text-xs text-destructive" role="alert">{t("oauthRenewalStale")}</p> : null}
      {isOpen ? (
        <div aria-labelledby={`integration-toggle-${integration.id}`} className="space-y-2 border-t border-border/70 px-3 py-3 text-xs text-muted-foreground" id={`integration-panel-${integration.id}`} role="region">
          <p>{integration.summary[settings.language]}</p>
          {integration.oauth ? <p><span className="font-medium text-foreground">{t("oauthAccessTitle")}: </span>{integration.oauth.access[settings.language]}</p> : null}
          {!connected ? <p>{handoffHeld ? t("oauthHandoffReviewStatus") : oauthReady ? t("oauthConsentNote") : t("oauthUnconfigured")}</p> : null}
          {status?.configured ? <p>{t(status.mode === "connect" ? "integrationViaConnect" : "integrationViaToken")}</p> : null}
          {connected && record?.refreshable && !renewalUncertain && !renewalStale ? <p>{t("renewsAutomatically")}</p> : null}
          {connected && record?.expiresAt ? <p>{t("expiresOn")} {new Date(record.expiresAt).toLocaleDateString(settings.language)}</p> : null}
          <a className="inline-flex items-center gap-1 underline underline-offset-2" href={integration.docsUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon className="size-3" />{t("docs")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
