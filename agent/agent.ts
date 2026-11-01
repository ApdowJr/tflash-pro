import { defineAgent, defineDynamic } from "eve";
import { modelUsageWindowReached } from "@/lib/usage-limits";
import { resolveLanguageModel } from "@/lib/providers/runtime";
import { selectionFromAttributes } from "@/lib/providers/selection";

/** The channel stores the validated provider selection in session auth. */
export default defineAgent({
  model: defineDynamic(async (ctx) => {
    const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
    const selection = selectionFromAttributes(auth?.attributes);
    const resolved = await resolveLanguageModel(selection, auth?.principalId);
    return {
      model: resolved.model,
      modelContextWindowTokens: resolved.contextWindow,
    };
  }),
  limits: { sessionUsage: modelUsageWindowReached },
  compaction: {
    // Keep long chats usable regardless of which provider is selected.
    threshold: 0.85,
  },
});
