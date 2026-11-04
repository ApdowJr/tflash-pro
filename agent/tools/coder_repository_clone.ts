import { snapshotWorkspace } from "../lib/coder-workspace";
import { normalizeRepositoryUrl, shellQuote } from "@/lib/repository";
import { sessionAgentMode } from "../lib/session-mode";
import { waitWithAbort } from "@/lib/abortable";
import { coderWorkspaceSnapshotSchema } from "@/lib/coder-workspace";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

const clone = defineTool({
  description: "Clone a credential-free public HTTPS GitHub, GitLab, or Bitbucket repository into an empty Coder sandbox. Requires approval. Never accepts URL credentials. Refuses a non-empty workspace and does not push, fetch credentials, or modify a remote repository. Returns the real post-clone workspace snapshot.",
  inputSchema: z.object({ url: z.string().trim().min(1).max(500) }).strict(),
  outputSchema: coderWorkspaceSnapshotSchema,
  availableInSubagents: false,
  approval: always(),
  label: { start: ({ url }) => `Clone ${url}` },
  async execute({ url: rawUrl }, ctx) {
    const url = normalizeRepositoryUrl(rawUrl);
    const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(120_000)]);
    const sandbox = await ctx.getSandbox();
    const env = { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const occupied = await waitWithAbort(sandbox.run({
      command: "set -o pipefail; find . -mindepth 1 -maxdepth 1 -print | head -n 1", env, signal,
    }), signal);
    if (occupied.exitCode !== 0) throw new Error("The workspace could not be checked before cloning.");
    if (occupied.stdout.trim()) throw new Error("Clone requires an empty workspace. Existing files were preserved.");
    const result = await waitWithAbort(sandbox.run({
      command: `git clone -- ${shellQuote(url)} .`, env, signal,
    }), signal);
    signal.throwIfAborted();
    if (result.exitCode !== 0) {
      throw new Error(`Clone failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 800)}. Inspect the workspace before retrying; no files were removed.`);
    }
    return snapshotWorkspace(sandbox, signal);
  },
});

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? clone : null);
