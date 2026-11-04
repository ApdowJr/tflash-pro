import { createHash } from "node:crypto";
import { waitWithAbort } from "@/lib/abortable";
import {
  CODER_DIFF_LIMIT,
  CODER_FILE_LIMIT,
  CODER_SNAPSHOT_FILE_LIMIT,
  isVisibleWorkspacePath,
  normalizeWorkspacePath,
  parseGitStatus,
  truncateText,
  type CoderWorkspaceRead,
  type CoderWorkspaceSnapshot,
  type CoderWorkspaceWrite,
} from "@/lib/coder-workspace";
import type { RuntimeSandboxSession } from "eve/sandbox";

const GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

type Sandbox = Pick<RuntimeSandboxSession, "run" | "readTextFile" | "writeTextFile" | "resolvePath">;

async function run(sandbox: Sandbox, command: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await waitWithAbort(sandbox.run({ command, env: GIT_ENV, signal }), signal);
  signal.throwIfAborted();
  return result;
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function readWorkspaceFile(
  sandbox: Sandbox,
  rawPath: string,
  signal: AbortSignal,
): Promise<CoderWorkspaceRead | undefined> {
  const path = normalizeWorkspacePath(rawPath);
  signal.throwIfAborted();
  const content = await waitWithAbort(sandbox.readTextFile({ path, signal }), signal);
  signal.throwIfAborted();
  if (content === null) return undefined;
  if (content.includes("\0")) throw new Error("Binary files cannot be opened in the text editor.");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > 100_000_000) throw new Error("This file is too large for the workspace editor.");
  const truncated = bytes > CODER_FILE_LIMIT;
  const visibleContent = truncated
    ? Buffer.from(content, "utf8").subarray(0, CODER_FILE_LIMIT).toString("utf8")
    : content;
  return {
    kind: "coder-workspace-read",
    version: 1,
    path,
    content: visibleContent,
    sha256: hash(content),
    bytes,
    totalLines: content.length === 0 ? 0 : content.split("\n").length,
    truncated,
  };
}

export async function writeWorkspaceFile(
  sandbox: Sandbox,
  input: { path: string; content: string; expectedSha256: string | null },
  signal: AbortSignal,
): Promise<CoderWorkspaceWrite> {
  const path = normalizeWorkspacePath(input.path);
  const before = await readWorkspaceFile(sandbox, path, signal);
  const previousSha256 = before?.sha256 ?? null;
  if (previousSha256 !== input.expectedSha256) {
    throw new Error(before
      ? "The file changed after it was loaded. Read it again before applying this draft."
      : "The file no longer exists. Reload the workspace before applying this draft.");
  }
  if (before?.truncated) throw new Error("Truncated files cannot be replaced from the editor.");
  if (Buffer.byteLength(input.content, "utf8") > CODER_FILE_LIMIT) {
    throw new Error("The draft exceeds the 200,000 byte editor limit.");
  }
  signal.throwIfAborted();
  await waitWithAbort(sandbox.writeTextFile({ path, content: input.content, signal }), signal);
  signal.throwIfAborted();
  const file = await readWorkspaceFile(sandbox, path, signal);
  if (!file || file.sha256 !== hash(input.content)) {
    throw new Error("The write could not be verified. Read the file again before retrying.");
  }
  return { kind: "coder-workspace-write", version: 1, file, previousSha256 };
}

const FIND_FILES_COMMAND = [
  "set -o pipefail; find .",
  "\\( -type d \\( -name .git -o -name .eve -o -name node_modules -o -name .next -o -name dist -o -name build -o -name coverage \\) -prune \\)",
  "-o -type f -print",
  "| LC_ALL=C sort",
  `| head -n ${CODER_SNAPSHOT_FILE_LIMIT + 100}`,
].join(" ");

export async function snapshotWorkspace(
  sandbox: Sandbox,
  signal: AbortSignal,
): Promise<CoderWorkspaceSnapshot> {
  const workspaceRoot = sandbox.resolvePath(".");
  const [listed, root] = await Promise.all([
    run(sandbox, FIND_FILES_COMMAND, signal),
    run(sandbox, "git rev-parse --show-toplevel", signal),
  ]);
  if (listed.exitCode !== 0) throw new Error(`Could not list workspace files: ${listed.stderr.slice(0, 500)}`);
  const visible = listed.stdout.split("\n")
    .map((line) => line.replace(/^\.\//, ""))
    .filter((path) => path && isVisibleWorkspacePath(path));
  const files = visible.slice(0, CODER_SNAPSHOT_FILE_LIMIT).map((path) => ({ path }));
  const filesTruncated = visible.length > files.length;

  const emptyRepository = {
    isRepository: false,
    changes: [],
    changesTruncated: false,
  };
  if (root.exitCode !== 0 || !root.stdout.trim()) {
    return {
      kind: "coder-workspace-snapshot", version: 1, workspaceRoot, files, filesTruncated,
      repository: emptyRepository,
      diff: "",
      diffTruncated: false,
      warnings: /not a git repository/i.test(root.stderr) ? [] : ["Git metadata is unavailable; repository state could not be observed."],
      capturedAt: new Date().toISOString(),
    };
  }

  const [branch, head, status, diff] = await Promise.all([
    run(sandbox, "git symbolic-ref --quiet --short HEAD", signal),
    run(sandbox, "git rev-parse --verify HEAD", signal),
    run(sandbox, "git -c core.quotepath=false status --porcelain=v1 --untracked-files=all", signal),
    run(sandbox, "if git rev-parse --verify HEAD >/dev/null 2>&1; then git -c core.quotepath=false diff --no-ext-diff --unified=3 HEAD -- .; else git -c core.quotepath=false diff --no-ext-diff --unified=3 -- . || exit $?; git -c core.quotepath=false diff --cached --no-ext-diff --unified=3 -- .; fi", signal),
  ]);
  const parsedChanges = status.exitCode === 0 ? parseGitStatus(status.stdout) : [];
  const changes = parsedChanges.slice(0, 200);
  const boundedDiff = truncateText(diff.stdout, CODER_DIFF_LIMIT);
  const revision = head.exitCode === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim())
    ? head.stdout.trim() : undefined;
  return {
    kind: "coder-workspace-snapshot",
    version: 1,
    workspaceRoot,
    files,
    filesTruncated,
    repository: {
      isRepository: true,
      root: root.stdout.trim().slice(0, 500),
      ...(branch.exitCode === 0 && branch.stdout.trim() ? { branch: branch.stdout.trim().slice(0, 255) } : {}),
      ...(revision ? { revision } : {}),
      changes,
      changesTruncated: parsedChanges.length > changes.length,
    },
    diff: boundedDiff.text,
    diffTruncated: boundedDiff.truncated,
    warnings: [
      ...(status.exitCode !== 0 ? ["Git status could not be read; the change list is incomplete."] : []),
      ...(diff.exitCode !== 0 ? ["The Git diff could not be read; the diff view is incomplete."] : []),
    ],
    capturedAt: new Date().toISOString(),
  };
}
