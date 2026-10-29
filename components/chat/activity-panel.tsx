"use client";
import { useState } from "react";
import type { EveMessage } from "eve/react";
import { useAppSettings } from "@/components/settings/app-settings";
import { useWorkspace } from "@/components/settings/workspace-store";
import { activityRows, reportedUsage } from "@/lib/activity";
import { downloadBlob } from "@/lib/download";
import { Button } from "@/components/ui/button";

const stateKeys = {
  "approval-requested": "activityPending",
  "approval-responded": "activityPending",
  cancelled: "activityCancelled",
  "output-available": "activitySucceeded",
  "output-error": "activityFailed",
  "output-denied": "activityDenied",
} as const;
export function ActivityPanel({
  messages,
  events,
}: {
  messages: readonly EveMessage[];
  events: Parameters<typeof reportedUsage>[0];
}) {
  const { t } = useAppSettings();
  const { workspace } = useWorkspace();
  const rows = activityRows(messages, events);
  const usage = reportedUsage(events);
  const cancelled = events.filter((e) => e.type === "turn.cancelled").at(-1);
  // Only label a cancellation as a budget stop if that turn requested > cap steps.
  const turnId =
    cancelled &&
    cancelled.data &&
    typeof cancelled.data === "object" &&
    "turnId" in cancelled.data
      ? cancelled.data.turnId
      : undefined;
  const limitStopped =
    turnId &&
    new Set(
      events
        .filter(
          (e) =>
            e.type === "step.started" &&
            e.data &&
            typeof e.data === "object" &&
            "turnId" in e.data &&
            e.data.turnId === turnId,
        )
        .map((e) => (e.data as { stepIndex: number }).stepIndex),
    ).size > workspace.maxSteps;
  return (
    <details className="mx-auto w-full max-w-2xl rounded-lg border bg-card text-xs">
      <summary className="tf-touch-target min-h-11 cursor-pointer rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {t("activityUsage")} · {rows.length}
      </summary>
      <div className="max-h-[40dvh] space-y-3 overflow-auto p-3 pt-0">
        {limitStopped ? <p role="status">{t("stepLimitReached")}</p> : null}
        <dl className="grid grid-cols-3 gap-2">
          {(
            [
              ["inputTokens", usage.inputTokens],
              ["outputTokens", usage.outputTokens],
              ["reportedCost", usage.costUsd],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{t(key)}</dt>
              <dd>
                {value === undefined
                  ? t("usageUnknown")
                  : key === "reportedCost"
                    ? `$${value.toFixed(4)}`
                    : value.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground">{t("usageHint")}</p>
        <p className="text-muted-foreground">{t("activityHint")}</p>
        {rows.length ? (
          <ol className="space-y-1">
            {rows.slice(-200).map((row) => (
              <li className="flex justify-between gap-2" key={row.id}>
                <span className="min-w-0 break-all font-mono">
                  {row.tool}
                  {row.at ? (
                    <time
                      className="ml-2 font-sans text-muted-foreground"
                      dateTime={row.at}
                    >
                      {new Date(row.at).toLocaleTimeString()}
                    </time>
                  ) : null}
                </span>
                <span className="shrink-0">
                  {t(
                    row.approved === false
                      ? "activityDenied"
                      : row.approved === true &&
                          row.state === "approval-responded"
                        ? "activityApproved"
                        : (stateKeys[row.state as keyof typeof stateKeys] ??
                          "activityRunning"),
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p>{t("noActivity")}</p>
        )}
        <ActivityDownload data={{ version: 1, usage, calls: rows }} />
      </div>
    </details>
  );
}
function ActivityDownload({ data }: { data: unknown }) {
  const { t } = useAppSettings();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        className="tf-touch-target min-h-11"
        variant="outline"
        size="sm"
        onClick={() => {
          try {
            downloadBlob(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
              "tflash-activity.json",
            );
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {t("activityDownload")}
      </Button>
      {failed ? <p role="alert">{t("downloadFailed")}</p> : null}
    </>
  );
}
