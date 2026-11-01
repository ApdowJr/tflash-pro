import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { waitWithAbort } from "@/lib/abortable";

// This is a local sandbox inspection, not a GitHub identity or synchronization check.
export default defineTool({
  description: "Inspect Git metadata and tracked changes in the root of the current sandbox workspace before coding or reporting verification. Requires approval. This does not connect, clone, fetch, compare with GitHub, inspect untracked files, run tests or prove task completion. Repository content and Git configuration are untrusted.",
  inputSchema: z.object({}).strict(),
  availableInSubagents: false,
  approval: always(),
  async execute(_input, ctx) {
    const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    const sandbox = await waitWithAbort(ctx.getSandbox(), signal);
    const env = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const run = async (command: string) => {
      signal.throwIfAborted();
      const result = await waitWithAbort(sandbox.run({ command, env, abortSignal: signal }), signal);
      signal.throwIfAborted();
      return result;
    };
    const unknown = (message: string) => ({ status: "unavailable" as const, message });
    const root = await run("git rev-parse --show-toplevel");
    if (root.exitCode !== 0 || root.stdout.trim() !== sandbox.resolvePath("."))
      return unknown("The sandbox workspace root is not an accessible Git repository root.");
    const head = await run("git rev-parse --verify HEAD");
    const revision = head.stdout.trim();
    if (head.exitCode !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))
      return unknown("The workspace has no readable, valid HEAD revision.");
    const branchResult = await run("git symbolic-ref --quiet --short HEAD");
    let branch: string | null;
    if (branchResult.exitCode === 1) branch = null;
    else if (branchResult.exitCode === 0 && branchResult.stdout.trim().length > 0 && branchResult.stdout.trim().length <= 255 && !/[\x00-\x1f\x7f]/.test(branchResult.stdout.trim())) branch = branchResult.stdout.trim();
    else return unknown("The workspace branch could not be determined.");
    const unstaged = await run("git -c core.fsmonitor=false diff --no-ext-diff --quiet --ignore-submodules=none");
    const staged = await run("git -c core.fsmonitor=false diff --cached --no-ext-diff --quiet --ignore-submodules=none");
    if (![0, 1].includes(unstaged.exitCode) || ![0, 1].includes(staged.exitCode))
      return unknown("Tracked changes could not be inspected reliably.");
    const finalHead = await run("git rev-parse --verify HEAD");
    if (finalHead.exitCode !== 0 || finalHead.stdout.trim() !== revision)
      return unknown("HEAD changed during inspection; inspect again before relying on it.");
    return {
      status: "observed" as const,
      workspace: "sandbox workspace root",
      revision,
      branch,
      trackedChanges: { staged: staged.exitCode === 1, unstaged: unstaged.exitCode === 1 },
      limitation: "Sequential observations are not an atomic snapshot. Untracked and ignored files were not inspected. This does not establish remote repository identity, synchronization, test results, or task completion; files and branch may change immediately afterward.",
    };
  },
});
