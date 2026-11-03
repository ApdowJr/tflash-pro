import { defineAgent, defineDynamic } from "eve";
import { modelUsageWindowReached } from "@/lib/usage-limits";
import { resolveLanguageModel } from "@/lib/providers/runtime";
import { selectionFromAttributes } from "@/lib/providers/selection";

/**
 * The model is chosen per request instead of being hard-coded. The browser
 * sends a validated provider/model selection; the eve channel copies it into
 * session auth attributes; this resolver turns it into an AI SDK model.
 *
 * Returning a live `LanguageModel` is how direct providers such as OpenRouter,
 * OpenAI, Anthropic, Groq, or Ollama are used; Gateway selections return a
 * model id. eve runs this before each model call.
 */
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
