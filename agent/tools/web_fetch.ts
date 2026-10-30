import { defineTool } from "eve/tools";
import { webApproval, permissionOwner } from "@/agent/lib/web-approval";
import { hasWebGrant } from "@/lib/permission-store";
import { fetchGrantedHomepage } from "@/lib/permission-web-fetch";
import { webFetch, type WebFetchToolOutput } from "eve/tools/web_fetch";
import { researchFetchInputSchema, researchFetchOutputSchema } from "@/lib/research";
import { researchOwner, sealSourceReceipt } from "@/lib/research-evidence";

export default defineTool({
  description: "Read a public HTTPS webpage for research. Returns bounded untrusted content, a retrieved-source card, and an opaque receipt for create_research_report. Ask permission before fetching; never put credentials/private data in a URL. A receipt proves retrieval by this app, not the truth of the page or a claim. Individually approved fetches use Eve DNS/IP and redirect checks; reusable homepage grants use a pinned public-IP request without redirects. Text/HTML/JSON/XML only; not a PDF or browser tool.",
  inputSchema: researchFetchInputSchema,
  outputSchema: researchFetchOutputSchema,
  approval: webApproval,
  availableInSubagents: false,
  label: { start: ({ url }) => `Read ${new URL(url).hostname}` },
  async execute(input, ctx) {
    const { url } = researchFetchInputSchema.parse(input);
    researchOwner(ctx); // Fail before network access if the session is unauthenticated.
    const owner = ctx.approval ? undefined : permissionOwner(ctx.session);
    if (!ctx.approval && (!owner || !await hasWebGrant(owner, url, ctx.abortSignal))) throw new Error("The reusable permission is no longer active; request approval again.");
    const execution = ctx.approval ? await webFetch.execute({ url, format: "markdown", timeout: 20 }, ctx) : await fetchGrantedHomepage(url, ctx.abortSignal, async (signal) => !!owner && await hasWebGrant(owner, url, signal));
    let result: WebFetchToolOutput | undefined;
    if (Symbol.asyncIterator in execution) {
      for await (const snapshot of execution) result = snapshot;
    } else result = execution;
    if (!result) throw new Error("The page returned no result.");
    // Eve 0.83.2 reports non-2xx responses using this prefix, not a status field.
    // Fail closed rather than certifying an HTTP error page as retrieved evidence.
    if (/^Request failed with status code:/i.test(result.content)) throw new Error("The page could not be read. Do not cite it as evidence.");
    const contentType = result.contentType.split(";")[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith("text/") && !["application/json", "application/xml", "application/xhtml+xml"].includes(contentType) && !contentType.endsWith("+xml") && !contentType.endsWith("+json")) {
      throw new Error("Unsupported page format. Supply a public text/HTML page instead.");
    }
    if (!result.content.trim()) throw new Error("The page returned no readable content.");
    const content = result.content.slice(0, 60_000);
    const source = {
      url, fetchedAt: new Date().toISOString(),
      excerpt: content.replace(/\s+/g, " ").trim().slice(0, 600),
      // Eve caps individual long lines without setting its aggregate flag.
      truncated: result.truncated || result.content.length > content.length || / \[truncated\](?:\r?\n|$)/.test(content),
    };
    return { kind: "tflash-source" as const, version: 1 as const, source, content, receipt: await sealSourceReceipt(source, ctx) };
  },
});
