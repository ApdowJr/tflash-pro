import type { AgentArtifact } from "@/lib/agent-workspace";
import {
  isResearchUrl,
  researchFetchOutputSchema,
  researchReportOutputSchema,
  type FetchedSource,
} from "@/lib/research";

export type ResearchLead = {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly publishedAt?: string;
  readonly query?: string;
};

export type ResearchEvidence = {
  readonly source: FetchedSource;
  /** Empty when only receipt-backed source metadata survives in a report. */
  readonly content: string;
};

export type ResearchReport = {
  readonly artifact: AgentArtifact;
  readonly sources: readonly FetchedSource[];
};

export type ResearchWorkspaceProjection = {
  readonly initialRequest?: string;
  readonly leads: readonly ResearchLead[];
  readonly evidence: readonly ResearchEvidence[];
  readonly report?: ResearchReport;
};

type Part = {
  readonly type: string;
  readonly text?: string;
  readonly name?: string;
  readonly toolName?: string;
  readonly state?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly partial?: boolean;
};
type Message = { readonly role: string; readonly parts: readonly Part[] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function settled(part: Part): boolean {
  return (part.state === "output-available" || part.state === "completed") && part.partial !== true;
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !isResearchUrl(value)) return undefined;
  return new URL(value).href;
}

function searchQuery(part: Part, output: Record<string, unknown> | undefined): string | undefined {
  const input = record(part.input);
  const action = record(output?.action);
  return text(input?.query ?? input?.objective ?? input?.search_query ?? input?.searchQuery
    ?? action?.query ?? (Array.isArray(action?.queries) ? action.queries[0] : undefined), 300);
}

function leadFrom(value: unknown, query?: string): ResearchLead | undefined {
  const item = record(value);
  const url = safeUrl(item?.url);
  if (!item || !url) return undefined;
  const highlights = Array.isArray(item.highlights) ? item.highlights[0] : undefined;
  return {
    url,
    ...(text(item.title, 300) ? { title: text(item.title, 300) } : {}),
    ...(text(item.excerpt ?? item.summary ?? highlights ?? item.text, 600)
      ? { snippet: text(item.excerpt ?? item.summary ?? highlights ?? item.text, 600) } : {}),
    ...(text(item.publishedDate ?? item.publishDate ?? item.pageAge, 100)
      ? { publishedAt: text(item.publishedDate ?? item.publishDate ?? item.pageAge, 100) } : {}),
    ...(query ? { query } : {}),
  };
}

function searchLeads(part: Part): ResearchLead[] {
  const output = part.output;
  const object = record(output);
  const query = searchQuery(part, object);
  const candidates = Array.isArray(output) ? output
    : Array.isArray(object?.results) ? object.results
      : Array.isArray(object?.sources) ? object.sources : [];
  return candidates.flatMap((candidate) => {
    const lead = leadFrom(candidate, query);
    return lead ? [lead] : [];
  });
}

/** Project provider search leads separately from receipt-backed fetched evidence. */
export function projectResearchWorkspace(messages: readonly Message[]): ResearchWorkspaceProjection {
  let initialRequest: string | undefined;
  let report: ResearchReport | undefined;
  const leads = new Map<string, ResearchLead>();
  const evidence = new Map<string, ResearchEvidence>();

  for (const message of messages) {
    if (message.role === "user" && initialRequest === undefined) {
      const value = message.parts.filter((part) => part.type === "text")
        .map((part) => part.text ?? "").join("\n").trim();
      if (value) initialRequest = value.slice(0, 4000);
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if ((part.type !== "tool" && part.type !== "dynamic-tool") || !settled(part)) continue;
      const name = part.toolName ?? part.name;
      if (name === "web_search") {
        for (const lead of searchLeads(part)) {
          const previous = leads.get(lead.url);
          leads.set(lead.url, { ...previous, ...lead });
        }
      } else if (name === "web_fetch") {
        const parsed = researchFetchOutputSchema.safeParse(part.output);
        if (parsed.success) evidence.set(parsed.data.source.url, {
          source: parsed.data.source,
          content: parsed.data.content,
        });
      } else if (name === "create_research_report") {
        const parsed = researchReportOutputSchema.safeParse(part.output);
        if (parsed.success) {
          report = { artifact: parsed.data.artifact, sources: parsed.data.sources };
          for (const source of parsed.data.sources) {
            if (!evidence.has(source.url)) evidence.set(source.url, { source, content: "" });
          }
        }
      }
    }
  }
  return { initialRequest, leads: [...leads.values()], evidence: [...evidence.values()], report };
}

export function researchDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Unknown source"; }
}
