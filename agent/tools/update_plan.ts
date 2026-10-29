import { defineTool } from "eve/tools";
import { planInputSchema, planOutputSchema } from "@/lib/agent-workspace";

export default defineTool({
  description: "Show or update the user's task plan. Send the complete current plan, keeping step ids stable. Use for multi-step work; update after actual progress. One step at a time may be in_progress. Use blocked with a reason when work cannot continue. This records progress only: it does not execute tasks or prove they succeeded.",
  inputSchema: planInputSchema,
  outputSchema: planOutputSchema,
  availableInSubagents: false,
  label: { start: ({ title }) => title },
  execute(input) {
    return { kind: "tflash-plan" as const, version: 1 as const, plan: planInputSchema.parse(input) };
  },
});
