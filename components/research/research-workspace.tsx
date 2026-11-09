"use client";

import { AgentPlanCard } from "@/components/chat/agent-workspace";
import { ResearchReportCard } from "@/components/chat/research";
import { useOptionalAppSettings } from "@/components/settings/app-settings";
import { Button } from "@/components/ui/button";
import type { AgentPlan } from "@/lib/agent-workspace";
import { researchDomain, type ResearchEvidence, type ResearchLead, type ResearchWorkspaceProjection } from "@/lib/research-workspace";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  FileTextIcon,
  GitCompareArrowsIcon,
  ListTodoIcon,
  Maximize2Icon,
  Minimize2Icon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";

type ResearchTab = "brief" | "leads" | "evidence" | "compare" | "report";

function LeadCard({ lead, evidence, disabled, onFetch }: {
  readonly lead: ResearchLead;
  readonly evidence?: ResearchEvidence;
  readonly disabled: boolean;
  readonly onFetch: () => void;
}) {
  const { t } = useOptionalAppSettings();
  const fetched = !!evidence;
  const hasFullText = !!evidence?.content;
  return <article className="rounded-lg border bg-card p-3">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">{t("researchSearchLeadBadge")}</span>{fetched ? <span className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><CheckIcon className="size-3" />{t("researchFetchedBadge")}</span> : null}</div>
        <h3 className="mt-2 break-words text-sm font-medium">{lead.title ?? researchDomain(lead.url)}</h3>
        <a className="mt-1 flex items-center gap-1 break-all text-[11px] text-primary underline underline-offset-2" href={lead.url} rel="noopener noreferrer" target="_blank">{researchDomain(lead.url)}<ExternalLinkIcon className="size-3 shrink-0" /></a>
      </div>
      <Button className="h-8 shrink-0 text-[11px]" disabled={disabled && !hasFullText} onClick={onFetch} size="sm" type="button" variant="outline">{hasFullText ? t("researchView") : fetched ? t("researchFetchAgain") : t("researchFetch")}</Button>
    </div>
    {lead.snippet ? <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{lead.snippet}</p> : null}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{lead.publishedAt ? <span>{t("researchProviderDate")} {lead.publishedAt}</span> : null}{lead.query ? <span>{t("researchQueryLabel")} {lead.query}</span> : null}</div>
    <p className="mt-2 text-[10px] text-muted-foreground">{t("researchSnippetCaveat")}</p>
  </article>;
}

function EvidenceSummary({ item, selected, compared, onInspect, onCompare }: {
  readonly item: ResearchEvidence;
  readonly selected: boolean;
  readonly compared: boolean;
  readonly onInspect: () => void;
  readonly onCompare: () => void;
}) {
  const { t } = useOptionalAppSettings();
  return <div className={cn("rounded-md border bg-card p-2", selected && "border-brand")}>
    <div className="flex items-center gap-2">
      <button className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-ring" onClick={onInspect} type="button">
        <span className="block truncate text-xs font-medium">{researchDomain(item.source.url)}</span>
        <span className="block text-[10px] text-muted-foreground">{item.content ? t("researchFullRetrieval") : t("researchReceiptMetadata")}</span>
      </button>
      <button aria-label={`${compared ? t("researchRemoveCompare") : t("researchAddCompare")} ${item.source.url} ${compared ? t("researchFromComparison") : t("researchToComparison")}`} aria-pressed={compared} className={cn("flex size-7 shrink-0 items-center justify-center rounded border text-muted-foreground", compared && "bg-brand text-white")} onClick={onCompare} type="button">{compared ? <CheckIcon className="size-3.5" /> : <GitCompareArrowsIcon className="size-3.5" />}</button>
    </div>
  </div>;
}

function SourceViewer({ item }: { readonly item: ResearchEvidence }) {
  const { t } = useOptionalAppSettings();
  return <article className="min-w-0 space-y-3">
    <div><span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">{t("researchFetchedEvidenceBadge")}</span><h3 className="mt-2 break-all text-sm font-medium">{item.source.url}</h3><p className="mt-1 text-[10px] text-muted-foreground">{t("researchRetrievedAt")} {item.source.fetchedAt}{item.source.truncated ? ` · ${t("researchPartialContent")}` : ""}</p></div>
    <a className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2" href={item.source.url} rel="noopener noreferrer" target="_blank">{t("researchOpenSource")}<ExternalLinkIcon className="size-3" /></a>
    <section><h4 className="text-xs font-medium">{t("researchSourceExcerpt")}</h4><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{item.source.excerpt}</p></section>
    {item.content ? <details className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">{t("researchInspectContent")}</summary><pre className="tflash-scroll max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words border-t p-3 font-sans text-xs leading-5">{item.content}</pre></details> : <p className="text-xs text-muted-foreground">{t("researchReceiptOnlyNote")}</p>}
    <p className="text-[10px] leading-4 text-muted-foreground">{t("researchRetrievalCaveat")}</p>
  </article>;
}

export function ResearchWorkspace({
  projection,
  plan,
  isBusy,
  disabled = false,
  mobileVisible = false,
  pendingApprovals = 0,
  expanded = false,
  onToggleExpand,
  onCommand,
  onReviewApprovals,
}: {
  readonly projection: ResearchWorkspaceProjection;
  readonly plan?: AgentPlan;
  readonly isBusy: boolean;
  readonly disabled?: boolean;
  readonly mobileVisible?: boolean;
  readonly pendingApprovals?: number;
  readonly expanded?: boolean;
  readonly onToggleExpand?: () => void;
  readonly onCommand: (text: string) => void;
  readonly onReviewApprovals: () => void;
}) {
  const { t } = useOptionalAppSettings();
  const [tab, setTab] = useState<ResearchTab>("brief");
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("");
  const [timeFrame, setTimeFrame] = useState("");
  const [deliverable, setDeliverable] = useState("Cited report with findings and limitations");
  const [inspectedUrl, setInspectedUrl] = useState<string>();
  const [compareUrls, setCompareUrls] = useState<string[]>([]);
  const readOnly = disabled || isBusy;
  const inspected = projection.evidence.find((item) => item.source.url === inspectedUrl) ?? projection.evidence[0];
  const compared = compareUrls.map((url) => projection.evidence.find((item) => item.source.url === url)).filter((item): item is ResearchEvidence => !!item);
  const tabs = [
    { id: "brief" as const, label: t("researchTabBrief"), icon: ListTodoIcon },
    { id: "leads" as const, label: `${t("researchTabLeads")} ${projection.leads.length}`, icon: SearchIcon },
    { id: "evidence" as const, label: `${t("researchTabEvidence")} ${projection.evidence.length}`, icon: BookOpenIcon },
    { id: "compare" as const, label: `${t("researchTabCompare")} ${compared.length}`, icon: GitCompareArrowsIcon },
    { id: "report" as const, label: t("researchTabReport"), icon: FileTextIcon },
  ];

  function startResearch() {
    if (readOnly || !question.trim()) return;
    onCommand([
      "Deep research brief:", `Question: ${question.trim()}`,
      `Scope: ${scope.trim() || "Use the narrowest useful scope for the question."}`,
      `Time frame: ${timeFrame.trim() || "Prefer current evidence and note publication/retrieval dates."}`,
      `Deliverable: ${deliverable}`,
      "Use a discover, read, compare, and synthesize workflow. Use update_plan for substantial work, web_search for leads, and approved web_fetch for evidence. Search snippets are not evidence. Compare fetched sources before synthesis, and use create_research_report only with actual receipts and explicit limitations.",
    ].join("\n"));
    setQuestion("");
  }

  function fetchLead(lead: ResearchLead) {
    if (readOnly) return;
    onCommand(`Read this research lead as evidence. Call web_fetch once with ${JSON.stringify({ url: lead.url })}. Do not treat the search snippet as evidence and do not create a report yet.`);
  }

  function openLead(lead: ResearchLead) {
    const evidence = projection.evidence.find((item) => item.source.url === lead.url);
    if (evidence?.content) {
      setInspectedUrl(lead.url);
      setTab("evidence");
      return;
    }
    fetchLead(lead);
  }

  function toggleCompare(url: string) {
    setCompareUrls((current) => current.includes(url) ? current.filter((item) => item !== url)
      : current.length < 2 ? [...current, url] : [current[1], url]);
  }

  function synthesizeComparison() {
    if (readOnly || compared.length !== 2) return;
    onCommand(`Compare the already fetched evidence at ${JSON.stringify(compared.map((item) => item.source.url))}. Identify agreements, conflicts, dates, methods, and limitations. Do not use search snippets as evidence. Create the final deliverable with create_research_report using the exact receipts already in this conversation; cite every finding and include limitations. If either page was not successfully fetched, stop instead of synthesizing it.`);
    setTab("report");
  }

  function createReport() {
    if (readOnly || projection.evidence.length === 0) return;
    onCommand(`Synthesize the current deep-research brief using only the fetched evidence in this conversation. Create the final deliverable with create_research_report and the exact source receipts already returned by web_fetch. Cite every finding, distinguish AI synthesis from source excerpts, and include explicit limitations. Do not add unread URLs or search snippets as sources.`);
  }

  return <section aria-label={t("researchWorkspaceLabel")} data-research-workspace className={cn(
    "min-h-0 min-w-0 flex-col border-t bg-muted/10 lg:flex lg:border-t-0 lg:border-l",
    mobileVisible ? "flex flex-1" : "hidden",
  )}>
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-background px-3 py-2">
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><FileSearchIcon className="size-4 text-brand" /><h2 className="text-sm font-semibold">{t("researchWorkspaceTitle")}</h2></div><p className="mt-0.5 text-[10px] text-muted-foreground">{t("researchWorkspaceSubtitle")}</p></div>
      <span className="rounded-md border bg-brand/5 px-2 py-1 text-[10px] font-medium text-brand">{t("researchStageDeep")}</span>
      {pendingApprovals > 0 ? <Button className="h-8 text-[11px]" onClick={onReviewApprovals} size="sm" type="button" variant="outline">{pendingApprovals} {pendingApprovals === 1 ? t("coderApprovalSingular") : t("coderApprovalPlural")}</Button> : null}
      {onToggleExpand ? <Button aria-label={t(expanded ? "restoreSplitPane" : "expandWorkspace")} aria-pressed={expanded} className="hidden size-8 lg:inline-flex" onClick={onToggleExpand} size="icon" title={t(expanded ? "restoreSplitPane" : "expandWorkspace")} type="button" variant="ghost">
        {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
      </Button> : null}
    </header>

    <div aria-label={t("researchStagesLabel")} className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-2 py-1.5" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => <button
        aria-selected={tab === id}
        className={cn("flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", tab === id && "bg-accent text-foreground")}
        key={id}
        onClick={() => setTab(id)}
        onKeyDown={(event) => {
          const currentIndex = tabs.findIndex((item) => item.id === id);
          let nextIndex = currentIndex;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = tabs.length - 1;
          else return;
          event.preventDefault();
          const nextTab = tabs[nextIndex];
          if (nextTab) {
            setTab(nextTab.id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
          }
        }}
        role="tab"
        tabIndex={tab === id ? 0 : -1}
        type="button"
      ><Icon className="size-3.5" />{label}</button>)}
    </div>

    {tab === "brief" ? <div className="tflash-scroll min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {projection.initialRequest ? <section className="rounded-lg border bg-card p-3"><p className="text-[10px] font-medium text-muted-foreground uppercase">{t("researchCurrentRequest")}</p><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{projection.initialRequest}</p></section> : null}
      <section className="space-y-3 rounded-lg border bg-card p-3"><div><h3 className="text-sm font-medium">{projection.initialRequest ? t("researchRefineBrief") : t("researchStartBrief")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("researchBriefHint")}</p></div>
        <label className="block text-xs font-medium">{t("researchQuestionLabel")}<textarea aria-label={t("researchQuestionAria")} className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background p-3 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setQuestion(event.target.value)} placeholder={t("researchQuestionPlaceholder")} value={question} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">{t("researchScopeLabel")}<input aria-label={t("researchScopeAria")} className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setScope(event.target.value)} placeholder={t("researchScopePlaceholder")} value={scope} /></label><label className="block text-xs font-medium">{t("researchTimeFrameLabel")}<input aria-label={t("researchTimeFrameAria")} className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setTimeFrame(event.target.value)} placeholder={t("researchTimeFramePlaceholder")} value={timeFrame} /></label></div>
        <label className="block text-xs font-medium">{t("researchDeliverableLabel")}<select aria-label={t("researchDeliverableAria")} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setDeliverable(event.target.value)} value={deliverable}><option value="Cited report with findings and limitations">{t("researchDeliverableCited")}</option><option value="Comparative source analysis">{t("researchDeliverableCompare")}</option><option value="Evidence summary with open questions">{t("researchDeliverableSummary")}</option></select></label>
        <Button disabled={readOnly || !question.trim()} onClick={startResearch} type="button">{projection.initialRequest ? t("researchRefineButton") : t("researchStartButton")}</Button>
      </section>
      {plan ? <AgentPlanCard plan={plan} /> : <p className="text-center text-[11px] text-muted-foreground">{t("researchPlanHint")}</p>}
    </div> : null}

    {tab === "leads" ? <div className="tflash-scroll min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <div className="flex items-center gap-2"><p className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">{t("researchLeadsHint")}</p><Button className="h-8 shrink-0 text-[11px]" disabled={readOnly} onClick={() => onCommand("Find additional primary and independent sources for the current research brief using web_search. Prefer sources that fill evidence gaps or challenge the current findings. Do not create a report yet.")} size="sm" type="button" variant="outline">{t("researchFindMore")}</Button></div>
      {projection.leads.length ? projection.leads.map((lead) => <LeadCard evidence={projection.evidence.find((item) => item.source.url === lead.url)} disabled={readOnly} key={lead.url} lead={lead} onFetch={() => openLead(lead)} />) : <div className="flex min-h-56 items-center justify-center text-center"><div><SearchIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-xs text-muted-foreground">{t("researchNoLeads")}</p></div></div>}
    </div> : null}

    {tab === "evidence" ? <div className="grid min-h-0 flex-1 grid-cols-[minmax(140px,0.36fr)_minmax(0,1fr)]">
      <aside className="tflash-scroll min-h-0 space-y-2 overflow-auto border-r p-2"><p className="px-1 py-1 text-[10px] text-muted-foreground">{t("researchComparePickHint")}</p>{projection.evidence.map((item) => <EvidenceSummary compared={compareUrls.includes(item.source.url)} item={item} key={item.source.url} onCompare={() => toggleCompare(item.source.url)} onInspect={() => setInspectedUrl(item.source.url)} selected={inspected?.source.url === item.source.url} />)}{projection.evidence.length === 0 ? <p className="p-2 text-xs text-muted-foreground">{t("researchNoEvidence")}</p> : null}</aside>
      <div className="tflash-scroll min-h-0 overflow-auto p-4">{inspected ? <SourceViewer item={inspected} /> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">{t("researchFetchLeadFirst")}</div>}</div>
    </div> : null}

    {tab === "compare" ? <div className="tflash-scroll min-h-0 flex-1 overflow-auto p-4">
      {compared.length === 2 ? <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2">{compared.map((item, index) => <article className="rounded-lg border bg-card p-3" key={item.source.url}><p className="text-[10px] font-medium text-brand">{t("researchSourceLabel")} {index + 1}</p><h3 className="mt-1 break-all text-xs font-medium">{item.source.url}</h3><p className="mt-1 text-[10px] text-muted-foreground">{t("researchCompareFetchedAt")} {item.source.fetchedAt}</p><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{item.source.excerpt}</p></article>)}</div><p className="text-[10px] leading-4 text-muted-foreground">{t("researchCompareCaveat")}</p><Button disabled={readOnly} onClick={synthesizeComparison} type="button">{t("researchSynthesizeButton")}</Button></div> : <div className="flex min-h-56 items-center justify-center text-center"><div><GitCompareArrowsIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-xs text-muted-foreground">{t("researchChooseTwoNote")}</p><Button className="mt-3" onClick={() => setTab("evidence")} size="sm" type="button" variant="outline">{t("researchChooseSourcesButton")}</Button></div></div>}
    </div> : null}

    {tab === "report" ? <div className="tflash-scroll min-h-0 flex-1 overflow-auto p-4">
      {projection.report ? <ResearchReportCard artifact={projection.report.artifact} sources={projection.report.sources} /> : <div className="flex min-h-56 items-center justify-center text-center"><div className="max-w-sm"><FileTextIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><h3 className="text-sm font-medium">{t("researchNoReportTitle")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("researchNoReportBody")}</p><Button className="mt-4" disabled={readOnly || projection.evidence.length === 0} onClick={createReport} type="button">{t("researchCreateReportButton")}</Button>{projection.evidence.length === 0 ? <p className="mt-2 text-[10px] text-muted-foreground">{t("researchFetchOneFirst")}</p> : null}</div></div>}
    </div> : null}
  </section>;
}
