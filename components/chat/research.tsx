"use client";

import { useAppSettings } from "@/components/settings/app-settings";
import type { FetchedSource } from "@/lib/research";
import type { AgentArtifact } from "@/lib/agent-workspace";
import { AgentArtifactCard } from "./agent-workspace";

export function ResearchSourceCard({ source, index }: { readonly source: FetchedSource; readonly index?: number }) {
  const { t } = useAppSettings();
  return (
    <section aria-label={t("fetchedSource")} className="min-w-0 space-y-2 rounded-xl border bg-card/60 p-3 text-xs">
      <p className="font-medium">{index ? `[${index}] ` : ""}{t("fetchedSource")}</p>
      <a className="block break-all text-primary underline underline-offset-2" href={source.url} rel="noopener noreferrer" target="_blank">{source.url}</a>
      <p className="text-muted-foreground">{t("sourceFetchedAt")}: <time dateTime={source.fetchedAt}>{source.fetchedAt}</time>{source.truncated ? ` · ${t("sourcePartial")}` : ""}</p>
      <details>
        <summary className="cursor-pointer text-muted-foreground">{t("sourceExcerpt")}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words">{source.excerpt}</p>
      </details>
      <p className="text-muted-foreground">{t("sourceCaveat")}</p>
    </section>
  );
}

export function ResearchReportCard({ artifact, sources }: { readonly artifact: AgentArtifact; readonly sources: readonly FetchedSource[] }) {
  const { t } = useAppSettings();
  return (
    <section aria-label={t("researchReport")} className="min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground">{t("researchSynthesis")}</p>
      <AgentArtifactCard artifact={artifact} />
      <details className="rounded-xl border p-3 text-xs">
        <summary className="cursor-pointer">{t("researchSources")} ({sources.length})</summary>
        <div className="mt-3 space-y-2">{sources.map((source, index) => <ResearchSourceCard index={index + 1} key={`${index}:${source.url}`} source={source} />)}</div>
      </details>
    </section>
  );
}
