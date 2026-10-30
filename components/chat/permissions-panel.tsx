"use client";
import { useCallback, useEffect, useState } from "react";
import { useAppSettings } from "@/components/settings/app-settings";
import { Button } from "@/components/ui/button";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
type Grant = { origin: string; expiresAt: string };
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [checked, setChecked] = useState<number>(),
    [now, setNow] = useState(() => Date.now());
  const url = `/api/chats/${encodeURIComponent(sessionId)}/permissions`;
  const request = useCallback(
    async (method: "GET" | "POST" | "DELETE", value?: string) => {
      setBusy(true);
      setError(false);
      try {
        const r = await fetch(url, {
          method,
          cache: "no-store",
          headers: {
            ...(ownerProof ? { [OWNER_PROOF_HEADER]: ownerProof } : {}),
            ...(method === "GET" ? {} : { "content-type": "application/json" }),
          },
          ...(method === "GET"
            ? {}
            : { body: JSON.stringify({ origin: value }) }),
        });
        const body = (await r.json()) as { grants?: Grant[] };
        if (!r.ok || !Array.isArray(body.grants)) throw new Error();
        setGrants(body.grants);
        setChecked(Date.now());
        setNow(Date.now());
        if (method === "POST") setOrigin("");
      } catch {
        setGrants(undefined);
        setError(true);
      } finally {
        setBusy(false);
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
              {t("permissionsUnavailable")}
            </p>
          ) : null}
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
                      onClick={() => void request("DELETE", g.origin)}
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
              if (origin.trim()) void request("POST", origin.trim());
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
            <Button className="self-end" type="submit" disabled={busy}>
              {t("permissionsGrant")}
            </Button>
          </form>
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
