import { createHash } from "node:crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { permissionOwner } from "@/agent/lib/web-approval";
import { getTask, settleTask } from "@/lib/tracked-task-store";
export default defineTool({
  description:
    "Verify the user-defined tracked task's exact file SHA-256 criterion in the current sandbox. Only the user defines criteria in the task panel. This checks one file at one moment, not the broader objective.",
  inputSchema: z.object({}).strict(),
  availableInSubagents: false,
  async execute(_input, ctx) {
    const owner = permissionOwner(ctx.session);
    if (!owner) throw new Error("An authenticated task owner is required.");
    const task = await getTask(owner);
    if (!task || task.state !== "awaiting_evidence")
      return {
        status: "unavailable",
        message: "No active task awaiting evidence.",
      };
    let reason = "The expected file was not found.",
      matched = false;
    try {
      const sandbox = await ctx.getSandbox();
      const stream = await sandbox.readFile({
        path: `/workspace/${task.path}`,
        abortSignal: ctx.abortSignal,
      });
      if (stream) {
        const reader = stream.getReader(),
          hash = createHash("sha256");
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
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
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
    } catch (error) {
      if (ctx.abortSignal.aborted) throw error;
      reason =
        error instanceof Error &&
        error.message ===
          "The expected file exceeds the verification size limit."
          ? error.message
          : "The file could not be read.";
    }
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
        message: "The task was cancelled or replaced during verification.",
      };
    return {
      status: matched ? "criterion_matched" : "awaiting_evidence",
      message: reason,
      limitation:
        "A file digest does not verify the full objective or prove the file remains unchanged.",
    };
  },
});
