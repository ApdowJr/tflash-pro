import { defineHook } from "eve/hooks";
import { defineState } from "eve/context";
import {
  ATTR_MAX_STEPS,
  countModelStep,
  modelStepLimit,
} from "@/lib/usage-limits";

const counter = defineState("tflash.model-step-budget.v1", () => ({
  turnId: "",
  steps: [] as readonly number[],
}));
export default defineHook({
  events: {
    "step.started"(event, ctx) {
      const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
      const transition = countModelStep(
        counter.get(),
        ctx.session.turn.id,
        event.data.stepIndex,
        modelStepLimit(auth?.attributes?.[ATTR_MAX_STEPS]),
      );
      counter.update(() => transition.state);
      // Eve cancels before this model call starts, not merely in the browser.
      if (transition.cancel) ctx.cancel();
    },
  },
});
