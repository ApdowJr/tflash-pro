"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSettings } from "@/components/settings/app-settings";
import { Button } from "@/components/ui/button";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
type Grant = { origin: string; expiresAt: string; revision: string };
export function PermissionsPanel({
  sessionId,
  ownerProof,
}: {
  sessionId: string;
  ownerProof?: string;
}) {
  const { t } = useAppSettings();
  const [open, setOpen] = useState(false),
    [grants, setGrants] = useState<Grant[]>(),
    [origin, setOrigin] = useState(""),
    [epoch, setEpoch] = useState<string>(),
    [allRevoked, setAllRevoked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<"unavailable" | "conflict">(),
    [checked, setChecked] = useState<number>(),
    [now, setNow] = useState(() => Date.now());
  const url = `/api/chats/${encodeURIComponent(sessionId)}/permissions`;
  const pending = useRef<AbortController | undefined>(undefined);
  const allRequest = useRef<AbortController | undefined>(undefined);
  const epochRef = useRef<string | undefined>(undefined);
  epochRef.current = epoch;
  useEffect(() => {
    setGrants(undefined); setEpoch(undefined); setAllRevoked(false); setChecked(undefined); setError(undefined); setBusy(false); setOrigin("");
    return () => { const active = pending.current; pending.current = undefined; active?.abort(); };
  }, [url, ownerProof]);
  const request = useCallback(
    async (method: "GET" | "POST" | "DELETE" | "ALL", value?: string, revision?: string | null) => {
      if (pending.current && (method !== "ALL" || pending.current === allRequest.current)) return;
      if (method === "ALL") { pending.current?.abort(); pending.current = undefined; }
      if ((method === "POST" || method === "DELETE") && !epochRef.current) return;
      const controller = new AbortController();
      pending.current = controller;
      if (method === "ALL") allRequest.current = controller;
      setBusy(true);
      setError(undefined);
      setAllRevoked(false);
      try {
        const r = await fetch(method === "ALL" ? `${url}/revoke-all` : url, {
          method: method === "ALL" ? "POST" : method,
          cache: "no-store",
          signal: controller.signal,
          headers: {
            ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}),
            ...(method === "GET" || method === "ALL" ? {} : { "content-type": "application/json" }),
          },
          ...(method === "GET" || method === "ALL"
            ? {}
            : { body: JSON.stringify({ origin: value, expectedRevision: revision, expectedEpoch: epochRef.current }) }),
        });
        const body = (await r.json()) as { grants?: Grant[]; epoch?: string; revoked?: boolean };
        if (!r.ok || (method === "ALL" ? body.revoked !== true : !Array.isArray(body.grants) || typeof body.epoch !== "string")) throw new Error(r.status === 409 ? "conflict" : "unavailable");
        if (pending.current !== controller) return;
        if (method === "ALL") {
          setGrants(undefined); setEpoch(undefined); setAllRevoked(true); setChecked(undefined);
          return;
        }
        setGrants(body.grants); setEpoch(body.epoch);
        setChecked(Date.now());
        setNow(Date.now());
        if (method === "POST") setOrigin("");
      } catch (reason) {
        if (pending.current === controller) { setGrants(undefined); setEpoch(undefined); setError(reason instanceof Error && reason.message === "conflict" ? "conflict" : "unavailable"); }
      } finally {
        if (pending.current === controller) { pending.current = undefined; if (allRequest.current === controller) allRequest.current = undefined; setBusy(false); }
      }
    },
    [url, ownerProof],
  );
  useEffect(() => {
    if (open) void request("GET");
  }, [open, request]);
  useEffect(() => {
    if (!open || !grants) return;
    const next = grants
      .map((g) => Date.parse(g.expiresAt))
      .filter((v) => v > now)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(next - Date.now() + 10, 2147483647)),
    );
    return () => window.clearTimeout(timer);
  }, [open, grants, now]);
  const active = grants?.filter((g) => Date.parse(g.expiresAt) > now);
  return (
    <details
      className="mx-auto w-full max-w-2xl rounded-lg border bg-card text-xs"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer px-3 py-3">
        {t("permissionsTitle")}
      </summary>
      {open ? (
        <div className="space-y-3 p-3 pt-0">
          <p>{t("permissionsExplanation")}</p>
          <p className="text-muted-foreground">{t("permissionsLimits")}</p>
          {error ? (
            <p role="alert" className="text-destructive">
              {t(error === "conflict" ? "permissionsConflict" : "permissionsUnavailable")}
            </p>
          ) : null}
          {allRevoked ? <p role="status">{t("permissionsAllRevoked")}</p> : null}
          {checked && active ? (
            <p>
              {t("permissionsChecked")} {new Date(checked).toLocaleString()}
            </p>
          ) : null}
          {active ? (
            <ul className="space-y-2">
              {active.length ? (
                active.map((g) => (
                  <li
                    key={g.origin}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 break-all">
                      {g.origin} · {t("permissionsExpires")}{" "}
                      {new Date(g.expiresAt).toLocaleString()}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void request("DELETE", g.origin, g.revision)}
                    >
                      {t("permissionsRevoke")}
                    </Button>
                  </li>
                ))
              ) : (
                <li>{t("permissionsNone")}</li>
              )}
            </ul>
          ) : null}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!origin.trim() || !grants) return;
              let normalized: string;
              try { normalized = new URL(origin.trim()).origin; } catch { normalized = origin.trim(); }
              void request("POST", origin.trim(), grants.find((g) => g.origin === normalized)?.revision ?? null);
            }}
          >
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              {t("permissionsOrigin")}
              <input
                className="min-h-11 rounded-md border bg-background px-2"
                type="url"
                required
                placeholder="https://example.com"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </label>
            <Button className="self-end" type="submit" disabled={busy || !grants}>
              {t("permissionsGrant")}
            </Button>
          </form>
          <p className="text-muted-foreground">{t("permissionsRevokeAllHint")}</p>
          <Button size="sm" variant="outline" disabled={busy && pending.current === allRequest.current} onClick={() => void request("ALL")}>
            {t("permissionsRevokeAll")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void request("GET")}
          >
            {t("permissionsRefresh")}
          </Button>
        </div>
      ) : null}
    </details>
  );
}
