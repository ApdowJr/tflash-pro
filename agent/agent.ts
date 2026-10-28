import { defineAgent, defineDynamic } from "eve";
import { DEFAULT_CONTEXT_WINDOW } from "@/lib/providers/catalog";
import { resolveLanguageModel } from "@/lib/providers/runtime";
import {
  gatewayFallbackModel,
  selectionFromAttributes,
} from "@/lib/providers/selection";

/**
 * The model is chosen per request instead of being hard-coded. The browser
 * sends a validated provider/model selection; the eve channel copies it into
 * session auth attributes; these resolvers turn it into an AI SDK model.
 *
 * - `session.started` returns a serializable Gateway model id (also used for
 *   session metadata and compaction).
 * - `step.started` may return a live `LanguageModel`, which is how direct
 *   providers such as OpenRouter, OpenAI, Anthropic, Groq, or Ollama are used.
 */
export default defineAgent({
  model: defineDynamic({
    events: {
      "session.started": (_event, ctx) => {
        const selection = selectionFromAttributes(
          ctx.session.auth.current?.attributes ?? ctx.session.auth.initiator?.attributes,
        );
        return {
          model: gatewayFallbackModel(selection),
          modelContextWindowTokens:
            selection.providerId === "gateway"
              ? selection.contextWindow
              : DEFAULT_CONTEXT_WINDOW,
        };
      },
      "step.started": async (_event, ctx) => {
        const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
        const selection = selectionFromAttributes(auth?.attributes);
        const resolved = await resolveLanguageModel(selection, auth?.principalId);
        return {
          model: resolved.model,
          modelContextWindowTokens: resolved.contextWindow,
        };
      },
    },
  }),
  compaction: {
    // Keep long chats usable regardless of which provider is selected.
    thresholdPercent: 0.85,
  },
});
