"use client";

import { AgentPlanCard } from "@/components/chat/agent-workspace";
import { ResearchReportCard } from "@/components/chat/research";
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
  const fetched = !!evidence;
  const hasFullText = !!evidence?.content;
  return <article className="rounded-lg border bg-card p-3">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">Search lead</span>{fetched ? <span className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><CheckIcon className="size-3" />Fetched</span> : null}</div>
        <h3 className="mt-2 break-words text-sm font-medium">{lead.title ?? researchDomain(lead.url)}</h3>
        <a className="mt-1 flex items-center gap-1 break-all text-[11px] text-primary underline underline-offset-2" href={lead.url} rel="noopener noreferrer" target="_blank">{researchDomain(lead.url)}<ExternalLinkIcon className="size-3 shrink-0" /></a>
      </div>
      <Button className="h-8 shrink-0 text-[11px]" disabled={disabled && !hasFullText} onClick={onFetch} size="sm" type="button" variant="outline">{hasFullText ? "View" : fetched ? "Fetch again" : "Fetch"}</Button>
    </div>
    {lead.snippet ? <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{lead.snippet}</p> : null}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{lead.publishedAt ? <span>Provider date: {lead.publishedAt}</span> : null}{lead.query ? <span>Query: {lead.query}</span> : null}</div>
    <p className="mt-2 text-[10px] text-muted-foreground">A search snippet is not fetched evidence.</p>
  </article>;
}

function EvidenceSummary({ item, selected, compared, onInspect, onCompare }: {
  readonly item: ResearchEvidence;
  readonly selected: boolean;
  readonly compared: boolean;
  readonly onInspect: () => void;
  readonly onCompare: () => void;
}) {
  return <div className={cn("rounded-md border bg-card p-2", selected && "border-brand")}>
    <div className="flex items-center gap-2">
      <button className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-ring" onClick={onInspect} type="button">
        <span className="block truncate text-xs font-medium">{researchDomain(item.source.url)}</span>
        <span className="block text-[10px] text-muted-foreground">{item.content ? "Full retrieval available" : "Receipt-backed metadata"}</span>
      </button>
      <button aria-label={`${compared ? "Remove" : "Add"} ${item.source.url} ${compared ? "from" : "to"} comparison`} aria-pressed={compared} className={cn("flex size-7 shrink-0 items-center justify-center rounded border text-muted-foreground", compared && "bg-brand text-white")} onClick={onCompare} type="button">{compared ? <CheckIcon className="size-3.5" /> : <GitCompareArrowsIcon className="size-3.5" />}</button>
    </div>
  </div>;
}

function SourceViewer({ item }: { readonly item: ResearchEvidence }) {
  return <article className="min-w-0 space-y-3">
    <div><span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">Fetched evidence</span><h3 className="mt-2 break-all text-sm font-medium">{item.source.url}</h3><p className="mt-1 text-[10px] text-muted-foreground">Retrieved {item.source.fetchedAt}{item.source.truncated ? " · partial content" : ""}</p></div>
    <a className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2" href={item.source.url} rel="noopener noreferrer" target="_blank">Open source<ExternalLinkIcon className="size-3" /></a>
    <section><h4 className="text-xs font-medium">Source excerpt</h4><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{item.source.excerpt}</p></section>
    {item.content ? <details className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">Inspect retrieved content</summary><pre className="tflash-scroll max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words border-t p-3 font-sans text-xs leading-5">{item.content}</pre></details> : <p className="text-xs text-muted-foreground">Only receipt-backed source metadata is present in this resumed history; full retrieved text is not available.</p>}
    <p className="text-[10px] leading-4 text-muted-foreground">Retrieval proves this app read the page, not that every claim in it is true.</p>
  </article>;
}

export function ResearchWorkspace({
  projection,
  plan,
  isBusy,
  disabled = false,
  mobileVisible = false,
  pendingApprovals = 0,
  onCommand,
  onReviewApprovals,
}: {
  readonly projection: ResearchWorkspaceProjection;
  readonly plan?: AgentPlan;
  readonly isBusy: boolean;
  readonly disabled?: boolean;
  readonly mobileVisible?: boolean;
  readonly pendingApprovals?: number;
  readonly onCommand: (text: string) => void;
  readonly onReviewApprovals: () => void;
}) {
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
    { id: "brief" as const, label: "Brief", icon: ListTodoIcon },
    { id: "leads" as const, label: `Leads ${projection.leads.length}`, icon: SearchIcon },
    { id: "evidence" as const, label: `Evidence ${projection.evidence.length}`, icon: BookOpenIcon },
    { id: "compare" as const, label: `Compare ${compared.length}`, icon: GitCompareArrowsIcon },
    { id: "report" as const, label: "Report", icon: FileTextIcon },
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

  return <section aria-label="Deep Research workspace" data-research-workspace className={cn(
    "min-h-0 min-w-0 flex-col border-t bg-muted/10 xl:flex xl:border-t-0 xl:border-l",
    mobileVisible ? "flex flex-1" : "hidden",
  )}>
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-background px-3 py-2">
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><FileSearchIcon className="size-4 text-brand" /><h2 className="text-sm font-semibold">Research workspace</h2></div><p className="mt-0.5 text-[10px] text-muted-foreground">Leads, fetched evidence, synthesis, and citations stay separate.</p></div>
      <span className="rounded-md border bg-brand/5 px-2 py-1 text-[10px] font-medium text-brand">Deep</span>
      {pendingApprovals > 0 ? <Button className="h-8 text-[11px]" onClick={onReviewApprovals} size="sm" type="button" variant="outline">{pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"}</Button> : null}
    </header>

    <div aria-label="Research stages" className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-2 py-1.5" role="tablist">
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
      {projection.initialRequest ? <section className="rounded-lg border bg-card p-3"><p className="text-[10px] font-medium text-muted-foreground uppercase">Current research request</p><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{projection.initialRequest}</p></section> : null}
      <section className="space-y-3 rounded-lg border bg-card p-3"><div><h3 className="text-sm font-medium">{projection.initialRequest ? "Refine the research brief" : "Start with a research brief"}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Deep is the default workflow. The question can stay focused; evidence gathering does the expanded work.</p></div>
        <label className="block text-xs font-medium">Question<textarea aria-label="Research question" className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background p-3 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setQuestion(event.target.value)} placeholder="What should be investigated?" value={question} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Scope<input aria-label="Research scope" className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setScope(event.target.value)} placeholder="Optional boundaries" value={scope} /></label><label className="block text-xs font-medium">Time frame<input aria-label="Research time frame" className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setTimeFrame(event.target.value)} placeholder="e.g. 2024–2026" value={timeFrame} /></label></div>
        <label className="block text-xs font-medium">Deliverable<select aria-label="Research deliverable" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-[16px] font-normal outline-none focus:ring-1 focus:ring-ring sm:text-xs" onChange={(event) => setDeliverable(event.target.value)} value={deliverable}><option>Cited report with findings and limitations</option><option>Comparative source analysis</option><option>Evidence summary with open questions</option></select></label>
        <Button disabled={readOnly || !question.trim()} onClick={startResearch} type="button">{projection.initialRequest ? "Refine deep research" : "Start deep research"}</Button>
      </section>
      {plan ? <AgentPlanCard plan={plan} /> : <p className="text-center text-[11px] text-muted-foreground">A substantial investigation will show its agent-reported plan here.</p>}
    </div> : null}

    {tab === "leads" ? <div className="tflash-scroll min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <div className="flex items-center gap-2"><p className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">Provider search results are discovery leads until their pages are fetched.</p><Button className="h-8 shrink-0 text-[11px]" disabled={readOnly} onClick={() => onCommand("Find additional primary and independent sources for the current research brief using web_search. Prefer sources that fill evidence gaps or challenge the current findings. Do not create a report yet.")} size="sm" type="button" variant="outline">Find more</Button></div>
      {projection.leads.length ? projection.leads.map((lead) => <LeadCard evidence={projection.evidence.find((item) => item.source.url === lead.url)} disabled={readOnly} key={lead.url} lead={lead} onFetch={() => openLead(lead)} />) : <div className="flex min-h-56 items-center justify-center text-center"><div><SearchIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-xs text-muted-foreground">No structured search leads yet. Start or continue a deep-research turn.</p></div></div>}
    </div> : null}

    {tab === "evidence" ? <div className="grid min-h-0 flex-1 grid-cols-[minmax(140px,0.36fr)_minmax(0,1fr)]">
      <aside className="tflash-scroll min-h-0 space-y-2 overflow-auto border-r p-2"><p className="px-1 py-1 text-[10px] text-muted-foreground">Select up to two sources to compare.</p>{projection.evidence.map((item) => <EvidenceSummary compared={compareUrls.includes(item.source.url)} item={item} key={item.source.url} onCompare={() => toggleCompare(item.source.url)} onInspect={() => setInspectedUrl(item.source.url)} selected={inspected?.source.url === item.source.url} />)}{projection.evidence.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No fetched evidence yet.</p> : null}</aside>
      <div className="tflash-scroll min-h-0 overflow-auto p-4">{inspected ? <SourceViewer item={inspected} /> : <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">Fetch a lead first. Only successful web_fetch results appear here.</div>}</div>
    </div> : null}

    {tab === "compare" ? <div className="tflash-scroll min-h-0 flex-1 overflow-auto p-4">
      {compared.length === 2 ? <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2">{compared.map((item, index) => <article className="rounded-lg border bg-card p-3" key={item.source.url}><p className="text-[10px] font-medium text-brand">Source {index + 1}</p><h3 className="mt-1 break-all text-xs font-medium">{item.source.url}</h3><p className="mt-1 text-[10px] text-muted-foreground">Fetched {item.source.fetchedAt}</p><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{item.source.excerpt}</p></article>)}</div><p className="text-[10px] leading-4 text-muted-foreground">These are retrieved excerpts, not an AI verdict. Synthesis requires a new report tool result.</p><Button disabled={readOnly} onClick={synthesizeComparison} type="button">Synthesize comparison</Button></div> : <div className="flex min-h-56 items-center justify-center text-center"><div><GitCompareArrowsIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-xs text-muted-foreground">Choose two fetched sources in Evidence to compare their actual excerpts.</p><Button className="mt-3" onClick={() => setTab("evidence")} size="sm" type="button" variant="outline">Choose sources</Button></div></div>}
    </div> : null}

    {tab === "report" ? <div className="tflash-scroll min-h-0 flex-1 overflow-auto p-4">
      {projection.report ? <ResearchReportCard artifact={projection.report.artifact} sources={projection.report.sources} /> : <div className="flex min-h-56 items-center justify-center text-center"><div className="max-w-sm"><FileTextIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><h3 className="text-sm font-medium">No generated report yet</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">The final report appears only after create_research_report validates real source receipts and produces the downloadable Markdown.</p><Button className="mt-4" disabled={readOnly || projection.evidence.length === 0} onClick={createReport} type="button">Create cited report</Button>{projection.evidence.length === 0 ? <p className="mt-2 text-[10px] text-muted-foreground">Fetch at least one source first.</p> : null}</div></div>}
    </div> : null}
  </section>;
}
