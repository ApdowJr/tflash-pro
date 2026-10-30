import { z } from "zod";

export const planStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  title: z.string().trim().min(1).max(160),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  detail: z.string().trim().max(400).optional(),
}).strict();

export const planInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  steps: z.array(planStepSchema).min(1).max(12),
}).strict().superRefine(({ steps }, ctx) => {
  if (new Set(steps.map((step) => step.id)).size !== steps.length) {
    ctx.addIssue({ code: "custom", message: "Each step needs a unique id.", path: ["steps"] });
  }
  if (steps.filter((step) => step.status === "in_progress").length > 1) {
    ctx.addIssue({ code: "custom", message: "Only one step can be in progress.", path: ["steps"] });
  }
});

export const planOutputSchema = z.object({
  kind: z.literal("tflash-plan"), version: z.literal(1), plan: planInputSchema,
}).strict();
export type AgentPlan = z.infer<typeof planInputSchema>;

const artifactTypes = {
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
} as const;

export const artifactInputSchema = z.object({
  filename: z.string().trim().min(1).max(100)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]*\.(txt|md|csv|json)$/, "Use a simple filename ending in .txt, .md, .csv or .json; paths are not allowed."),
  description: z.string().trim().min(1).max(240),
  content: z.string().min(1).max(100_000),
}).strict().superRefine(({ filename, content }, ctx) => {
  if (filename.endsWith(".json")) {
    try { JSON.parse(content); } catch {
      ctx.addIssue({ code: "custom", path: ["content"], message: "JSON files must contain valid JSON." });
    }
  }
});
export const artifactOutputSchema = z.object({
  kind: z.literal("tflash-artifact"), version: z.literal(1),
  artifact: artifactInputSchema,
}).strict();
export type AgentArtifact = z.infer<typeof artifactInputSchema>;

export function artifactMediaType(filename: string): string {
  return artifactTypes[filename.split(".").at(-1) as keyof typeof artifactTypes] ?? artifactTypes.txt;
}

/** Only settled authored-tool results count; user text and pending inputs do not. */
export function latestAgentPlan(messages: readonly {
  readonly role: string;
  readonly parts: readonly {
    readonly type: string; readonly toolName?: string; readonly state?: string; readonly output?: unknown; readonly partial?: boolean;
  }[];
}[]): AgentPlan | undefined {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    if (message.role !== "assistant") continue;
    for (let p = message.parts.length - 1; p >= 0; p--) {
      const part = message.parts[p];
      if (part.type !== "dynamic-tool" || part.toolName !== "update_plan" || part.state !== "output-available" || part.partial === true) continue;
      const parsed = planOutputSchema.safeParse(part.output);
      if (parsed.success) return parsed.data.plan;
    }
  }
  return undefined;
}
