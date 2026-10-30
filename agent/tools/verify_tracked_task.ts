import { createHash } from "node:crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { permissionOwner } from "@/agent/lib/web-approval";
import { getTask, settleTask } from "@/lib/tracked-task-store";
import { waitWithAbort } from "@/lib/abortable";
export default defineTool({
  description:
    "Verify the user-defined tracked task's exact file SHA-256 criterion in the current sandbox. Only the user defines criteria in the task panel. This checks one file at one moment, not the broader objective.",
  inputSchema: z.object({}).strict(),
  availableInSubagents: false,
  async execute(_input, ctx) {
    const owner = permissionOwner(ctx.session);
    if (!owner) throw new Error("An authenticated task owner is required.");
    const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    const task = await waitWithAbort(getTask(owner), signal);
    if (!task || task.state === "cancelled")
      return {
        status: "unavailable",
        message: "No active task available for verification.",
      };
    let reason = "The expected file was not found.",
      matched = false;
    try {
      signal.throwIfAborted();
      const sandbox = await waitWithAbort(ctx.getSandbox(), signal);
      signal.throwIfAborted();
      const read = sandbox.readFile({
        path: `/workspace/${task.path}`,
        abortSignal: signal,
      });
      let stream;
      try {
        stream = await waitWithAbort(read, signal);
        signal.throwIfAborted();
      } catch (error) {
        // A provider can ignore its signal and resolve after the caller has
        // stopped waiting. Release that stream without treating it as proof.
        void read.then((late) => {
          if (late) void late.cancel().catch(() => {});
        }, () => {});
        throw error;
      }
      if (stream) {
        const reader = stream.getReader(),
          hash = createHash("sha256");
        let size = 0;
        try {
          while (true) {
            const { done, value } = await waitWithAbort(reader.read(), signal);
            if (done) break;
            size += value.byteLength;
            if (size > 5 * 1024 * 1024)
              throw new Error(
                "The expected file exceeds the verification size limit.",
              );
            hash.update(value);
          }
          matched = hash.digest("hex") === task.sha256;
          reason = matched
            ? "The exact file digest matched at verification time."
            : "The file digest did not match.";
        } finally {
          // Cancellation must not wait forever for an uncooperative stream.
          // It is best-effort; never claim that the provider actually stopped.
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      reason =
        error instanceof Error &&
        error.message ===
          "The expected file exceeds the verification size limit."
          ? error.message
          : "The file could not be read.";
    }
    signal.throwIfAborted();
    if (
      !(await settleTask(
        owner,
        task.revision,
        matched ? "criterion_matched" : "awaiting_evidence",
        reason,
      ))
    )
      return {
        status: "changed",
        message: "The task changed during verification; refresh and retry if needed.",
      };
    return {
      status: matched ? "criterion_matched" : "awaiting_evidence",
      message: reason,
      limitation:
        "A file digest does not verify the full objective or prove the file remains unchanged.",
    };
  },
});
