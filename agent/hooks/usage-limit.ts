import { defineHook } from "eve/hooks";
import { runs } from "eve/events";
import { createLogger } from "@/lib/observability/logger";
import { ATTR_MAX_STEPS, modelStepLimit } from "@/lib/usage-limits";

const log = createLogger("agent:usage-limit");

export default defineHook({
  events: {
    "model.requested"(event, ctx) {
      const turnId = event.scope?.turnId;
      if (!turnId) return;

      const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
      const limit = modelStepLimit(auth?.attributes?.[ATTR_MAX_STEPS]);
      const runCount = runs(ctx.view, { turnId }).length;
      if (runCount <= limit) return;

      // The durable view already includes this requested run, so cancel before
      // the model call starts instead of tracking duplicate client-side steps.
      log.warn("model call limit reached", { turnId, runCount, limit });
      ctx.cancel();
    },
  },
});
