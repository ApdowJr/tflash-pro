"use client";

import { DocumentExportButtons } from "./documents";
import { useState } from "react";
import { CheckIcon, CircleIcon, DownloadIcon, FileTextIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { artifactMediaType, type AgentArtifact, type AgentPlan } from "@/lib/agent-workspace";
import { useAppSettings } from "@/components/settings/app-settings";
import { Button } from "@/components/ui/button";

const stepIcons = { pending: CircleIcon, in_progress: Loader2Icon, completed: CheckIcon, blocked: TriangleAlertIcon };
const stepKeys = { pending: "stepPending", in_progress: "stepInProgress", completed: "stepCompleted", blocked: "stepBlocked" } as const;

export type AgentRunState = "working" | "waiting" | "idle" | "resuming" | "failed";
const runKeys = { working: "agentWorking", waiting: "agentWaiting", idle: "agentIdle", resuming: "loadingChat", failed: "requestFailed" } as const;

export function AgentPlanCard({ plan, compact = false, runState, onContinue }: {
  readonly plan: AgentPlan; readonly compact?: boolean; readonly runState?: AgentRunState;
  readonly onContinue?: () => Promise<void>;
}) {
  const { t } = useAppSettings();
  const [continuing, setContinuing] = useState(false);
  const [continueFailed, setContinueFailed] = useState(false);
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const body = (
    <div className="space-y-3 px-3 pb-3">
      <p className="text-xs text-muted-foreground">{t("planReported")}</p>
      <ol className="space-y-2">
        {plan.steps.map((step) => {
          const Icon = stepIcons[step.status];
          return (
            <li className="flex items-start gap-2 text-sm" key={step.id}>
              <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${step.status === "blocked" ? "text-amber-600" : "text-muted-foreground"}`} />
              <div className="min-w-0 flex-1 break-words">
                <p>{step.title} <span className="text-xs text-muted-foreground">· {t(stepKeys[step.status])}</span></p>
                {step.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {onContinue && completed < plan.steps.length && (runState === "idle" || runState === "failed") ? (
        <div className="space-y-2">
          <Button disabled={continuing} onClick={async () => {
            setContinuing(true);
            setContinueFailed(false);
            try { await onContinue(); } catch { setContinueFailed(true); }
            finally { setContinuing(false); }
          }} size="sm" type="button" variant="outline">{t(continuing ? "agentWorking" : "continueTask")}</Button>
          {continueFailed ? <p className="text-xs text-destructive" role="alert">{t("continueTaskFailed")}</p> : null}
        </div>
      ) : null}
    </div>
  );
  const heading = <>{runState ? <span className="shrink-0 text-xs text-muted-foreground" role="status">{t(runKeys[runState])}</span> : null}<span className="min-w-0 flex-1 break-words font-medium">{plan.title}</span><span className="shrink-0 text-xs text-muted-foreground">{completed}/{plan.steps.length} {t("stepCompleted")}</span></>;
  if (compact) return (
    <details className="mx-auto w-full max-w-2xl rounded-lg border bg-card">
      <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm" aria-label={t("taskPlan")}>{heading}</summary>
      <div className="max-h-[35dvh] overflow-y-auto">{body}</div>
    </details>
  );
  return <section aria-label={t("taskPlan")} className="min-w-0 rounded-lg border bg-card"><div className="flex items-center gap-3 p-3 text-sm">{heading}</div>{body}</section>;
}

export function AgentArtifactCard({ artifact }: { readonly artifact: AgentArtifact }) {
  const { t } = useAppSettings();
  const [error, setError] = useState(false);
  function download() {
    setError(false);
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([artifact.content], { type: artifactMediaType(artifact.filename) }));
      link = document.createElement("a");
      link.href = url;
      link.download = artifact.filename;
      document.body.appendChild(link);
      link.click();
      // Give the browser time to begin the download before releasing the URL.
      const created = url;
      window.setTimeout(() => URL.revokeObjectURL(created), 1000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setError(true);
    } finally { link?.remove(); }
  }
  return (
    <section aria-label={`${t("deliverable")}: ${artifact.filename}`} className="min-w-0 space-y-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 break-all text-sm font-medium">{artifact.filename}</span>
        <Button aria-label={`${t("downloadFile")}: ${artifact.filename}`} onClick={download} size="sm" type="button" variant="outline"><DownloadIcon className="size-3.5" />{t("downloadFile")}</Button>
      </div>
      <p className="break-words text-xs text-muted-foreground">{artifact.description}</p>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">{t("previewFile")}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{artifact.content}</pre>
      </details>
      <DocumentExportButtons filename={artifact.filename} content={artifact.content} />
      <p className="text-[11px] text-muted-foreground">{t("artifactReview")}</p>
      {error ? <p className="text-xs text-destructive" role="alert">{t("downloadFailed")}</p> : null}
    </section>
  );
}
