"use client";

import { useMemo, useState } from "react";
import { useAppSettings } from "@/components/settings/app-settings";
import { reportedUsage } from "@/lib/activity";

/** Render only when requested; never interpret usage as a bill or a budget. */
export function UsagePanel({ events }: { events: Parameters<typeof reportedUsage>[0] }) {
  const { t } = useAppSettings();
  const [open, setOpen] = useState(false);
  const usage = useMemo(() => open ? reportedUsage(events) : {}, [events, open]);
  return (
    <details className="rounded-lg border bg-card text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="tf-touch-target min-h-11 cursor-pointer rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{t("usagePanelTitle")}</summary>
      {open ? <div className="space-y-3 p-3 pt-0">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([["inputTokens",usage.inputTokens],["outputTokens",usage.outputTokens],["reportedCost",usage.costUsd]] as const).map(([key,value]) => (
            <div key={key}><dt className="text-muted-foreground">{t(key)}</dt><dd>{value === undefined ? t("usageUnknown") : key === "reportedCost" ? `$${value.toFixed(4)}` : value.toLocaleString()}</dd></div>
          ))}
        </dl>
        <p className="text-muted-foreground">{t("usageHint")}</p>
        <p className="text-muted-foreground">{t("usagePanelScope")}</p>
      </div> : null}
    </details>
  );
}
