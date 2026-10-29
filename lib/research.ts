import { z } from "zod";
import { artifactInputSchema } from "./agent-workspace";

/** Link validation only. Eve's fetcher additionally validates DNS/IPs on every hop. */
export function isResearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443");
  } catch { return false; }
}
export const researchUrlSchema = z.string().max(2048).refine(isResearchUrl, "Use a public HTTPS URL without credentials or a custom port.").transform((value) => new URL(value).href).pipe(z.string().max(2048));
export const fetchedSourceSchema = z.object({
  url: researchUrlSchema,
  fetchedAt: z.iso.datetime(),
  excerpt: z.string().max(600),
  truncated: z.boolean(),
}).strict();
export type FetchedSource = z.infer<typeof fetchedSourceSchema>;
export const researchFetchInputSchema = z.object({ url: researchUrlSchema }).strict();
export const researchFetchOutputSchema = z.object({
  kind: z.literal("tflash-source"), version: z.literal(1),
  source: fetchedSourceSchema,
  content: z.string().max(60_000),
  receipt: z.string().max(8192),
}).strict();

export const researchReportInputSchema = z.object({
  filename: z.string().max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]*\.md$/),
  language: z.enum(["en", "so"]),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(3000),
  receipts: z.array(z.string().min(1).max(8192)).min(1).max(12),
  findings: z.array(z.object({
    claim: z.string().trim().min(1).max(1000),
    sources: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  }).strict()).min(1).max(24),
  limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
}).strict().superRefine((report, ctx) => {
  if (new Set(report.receipts).size !== report.receipts.length) {
    ctx.addIssue({ code: "custom", path: ["receipts"], message: "Do not repeat a source receipt." });
  }
  if (report.findings.some((finding) => finding.sources.some((index) => index > report.receipts.length))) {
    ctx.addIssue({ code: "custom", path: ["findings"], message: "Citations must refer to the supplied receipts, numbered from 1." });
  }
});
export const researchReportOutputSchema = z.object({
  kind: z.literal("tflash-research-report"), version: z.literal(1),
  artifact: artifactInputSchema,
  sources: z.array(fetchedSourceSchema).min(1).max(12),
}).strict();

// Escape authored text so a downloaded Markdown report cannot inject fake
// citation links, images, headings or HTML via summary/claim/source excerpts.
function plainMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_{}\[\]<>#!|])/g, "\\$1").replace(/[\r\n]+/g, " ");
}
export function researchMarkdown(report: z.infer<typeof researchReportInputSchema>, sources: readonly FetchedSource[]): string {
  const so = report.language === "so";
  return [
    `# ${plainMarkdown(report.title)}`, "",
    so ? "> Soo-koobid AI sameeyay; il la akhriyey ma caddaynayso saxnaanta sheegasho kasta." : "> AI-written synthesis. Fetching a source does not independently verify each claim.", "",
    plainMarkdown(report.summary), "",
    so ? "## Natiijooyinka" : "## Findings", "",
    ...report.findings.map((finding) => `- ${plainMarkdown(finding.claim)} ${[...new Set(finding.sources)].map((n) => `[${n}]`).join(" ")}`), "",
    so ? "## Xaddidaadaha" : "## Limitations", "",
    ...report.limitations.map((item) => `- ${plainMarkdown(item)}`), "",
    so ? "## Ilaha la akhriyey" : "## Fetched sources", "",
    ...sources.flatMap((source, index) => [
      `[${index + 1}]: <${source.url.replace(/>/g, "%3E").replace(/</g, "%3C")}>`,
      `- ${so ? "La akhriyey" : "Fetched"}: ${source.fetchedAt}${source.truncated ? ` · ${so ? "Qayb keliya" : "Partial content"}` : ""}`,
      `- ${so ? "Qoraal ka mid ah isha" : "Source excerpt"}: ${plainMarkdown(source.excerpt)}`, "",
    ]),
    so ? "URLs-ku waa cinwaannadii la codsaday; boggu wuxuu u wareegi karay cinwaan kale. Ilaha webku way isbeddeli karaan." : "URLs identify the requested pages, which may have redirected. Web content can change after retrieval.", "",
  ].join("\n");
}
