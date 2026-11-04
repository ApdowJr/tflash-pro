import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "tsx/esm/api";
register();

const {
  coderWorkspaceSnapshotSchema,
  isTestCommand,
  normalizeWorkspacePath,
  parseGitStatus,
} = await import("../lib/coder-workspace.ts");
const { projectCoderWorkspace } = await import("../lib/coder-workspace-projection.ts");
const { readWorkspaceFile, snapshotWorkspace, writeWorkspaceFile } = await import("../agent/lib/coder-workspace.ts");
const { sessionAgentMode } = await import("../agent/lib/session-mode.ts");
const { normalizeRepositoryUrl, shellQuote } = await import("../lib/repository.ts");
const hash = (value) => createHash("sha256").update(value).digest("hex");

const readResult = (path = "src/a.ts", content = "const a = 1;\n") => ({
  kind: "coder-workspace-read", version: 1, path, content,
  sha256: hash(content), bytes: Buffer.byteLength(content), totalLines: content.split("\n").length, truncated: false,
});
const snapshotResult = () => ({
  kind: "coder-workspace-snapshot", version: 1, workspaceRoot: "/workspace",
  files: [{ path: "src/a.ts" }], filesTruncated: false,
  repository: { isRepository: true, root: "/workspace", branch: "main", revision: "a".repeat(40), changes: [{ path: "src/a.ts", status: " M" }], changesTruncated: false },
  diff: "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;", diffTruncated: false, warnings: [], capturedAt: "2026-11-04T12:00:00.000Z",
});

test("workspace paths reject traversal, internals, secrets, and ambiguous forms", () => {
  for (const valid of ["src/a.ts", "./src/a.ts", "docs/.env.example", "notes/README.md"]) {
    assert.equal(normalizeWorkspacePath(valid), valid.replace(/^\.\//, ""));
  }
  for (const invalid of ["../secret", "/etc/passwd", "$HOME/.env", ".git/config", ".eve/session", ".env", ".env.local", "a\\b.ts", "a\nb.ts", "", "."]) {
    assert.throws(() => normalizeWorkspacePath(invalid), undefined, invalid);
  }
});

test("Git status parsing preserves staged state, untracked files, and rename targets", () => {
  assert.deepEqual(parseGitStatus("## main\n M src/a.ts\nM  src/b.ts\n?? notes.txt\nR  old.ts -> new.ts\n"), [
    { status: " M", path: "src/a.ts" },
    { status: "M ", path: "src/b.ts" },
    { status: "??", path: "notes.txt" },
    { status: "R ", path: "new.ts", previousPath: "old.ts" },
  ]);
  assert.equal(isTestCommand("corepack pnpm test"), true);
  assert.equal(isTestCommand("pytest -q"), true);
  assert.equal(isTestCommand("pnpm install"), false);
});

test("file writes require the latest observed hash and verify the persisted content", async () => {
  let content = "before\n";
  let writes = 0;
  const sandbox = {
    readTextFile: async () => content,
    writeTextFile: async ({ content: next }) => { writes++; content = next; },
  };
  const signal = new AbortController().signal;
  const observed = await readWorkspaceFile(sandbox, "src/a.ts", signal);
  assert.equal(observed.sha256, hash("before\n"));
  content = "someone else\n";
  await assert.rejects(() => writeWorkspaceFile(sandbox, { path: "src/a.ts", content: "mine\n", expectedSha256: observed.sha256 }, signal), /changed after/);
  assert.equal(writes, 0);
  const current = await readWorkspaceFile(sandbox, "src/a.ts", signal);
  const written = await writeWorkspaceFile(sandbox, { path: "src/a.ts", content: "mine\n", expectedSha256: current.sha256 }, signal);
  assert.equal(writes, 1);
  assert.equal(written.file.content, "mine\n");
  assert.equal(written.previousSha256, current.sha256);
});

test("new-file writes cannot overwrite an existing file and truncated files are read-only", async () => {
  let content;
  const sandbox = {
    readTextFile: async () => content ?? null,
    writeTextFile: async ({ content: next }) => { content = next; },
  };
  const signal = new AbortController().signal;
  const created = await writeWorkspaceFile(sandbox, { path: "new.ts", content: "new\n", expectedSha256: null }, signal);
  assert.equal(created.previousSha256, null);
  await assert.rejects(() => writeWorkspaceFile(sandbox, { path: "new.ts", content: "overwrite", expectedSha256: null }, signal), /changed after|no longer exists/);
  content = "x".repeat(200_100);
  const truncated = await readWorkspaceFile(sandbox, "new.ts", signal);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.content.length <= 200_000);
  await assert.rejects(() => writeWorkspaceFile(sandbox, { path: "new.ts", content: "small", expectedSha256: truncated.sha256 }, signal), /Truncated files/);
});

test("sandbox snapshots contain bounded real file and Git observations", async () => {
  const sandbox = {
    resolvePath: () => "/workspace",
    run: async ({ command }) => {
      if (command.includes("find .")) return { exitCode: 0, stdout: "./src/a.ts\n./.env\n./.git/config\n./README.md\n", stderr: "" };
      if (command === "git rev-parse --show-toplevel") return { exitCode: 0, stdout: "/workspace\n", stderr: "" };
      if (command === "git symbolic-ref --quiet --short HEAD") return { exitCode: 0, stdout: "main\n", stderr: "" };
      if (command === "git rev-parse --verify HEAD") return { exitCode: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command.includes("status --porcelain")) return { exitCode: 0, stdout: " M src/a.ts\n?? README.md\n", stderr: "" };
      if (command.startsWith("if git rev-parse")) return { exitCode: 0, stdout: "diff --git a/src/a.ts b/src/a.ts\n", stderr: "" };
      throw new Error(`Unexpected command: ${command}`);
    },
  };
  const result = await snapshotWorkspace(sandbox, new AbortController().signal);
  assert.equal(coderWorkspaceSnapshotSchema.safeParse(result).success, true);
  assert.deepEqual(result.files.map((file) => file.path), ["src/a.ts", "README.md"]);
  assert.equal(result.repository.branch, "main");
  assert.equal(result.repository.changes.length, 2);
  assert.match(result.diff, /diff --git/);
});

test("Coder projection uses only settled tool output and tracks stale snapshots", () => {
  const read = readResult();
  const updated = readResult("src/a.ts", "const a = 2;\n");
  const messages = [
    { role: "assistant", parts: [
      { type: "dynamic-tool", toolName: "coder_workspace_snapshot", toolCallId: "s", state: "output-available", output: snapshotResult() },
      { type: "dynamic-tool", toolName: "coder_workspace_read", toolCallId: "r", state: "output-available", output: read },
      { type: "dynamic-tool", toolName: "bash", toolCallId: "b", state: "output-available", input: { command: "pnpm test" }, output: { status: "completed", exitCode: 0, stdout: "ok", stderr: "", truncated: false } },
    ] },
    { role: "assistant", parts: [
      { type: "dynamic-tool", toolName: "coder_workspace_snapshot", toolCallId: "partial", state: "output-available", partial: true, output: { ...snapshotResult(), workspaceRoot: "/wrong" } },
      { type: "tool", name: "coder_workspace_write", callId: "w", state: "completed", output: { kind: "coder-workspace-write", version: 1, file: updated, previousSha256: read.sha256 } },
    ] },
  ];
  const projected = projectCoderWorkspace(messages);
  assert.equal(projected.snapshot.workspaceRoot, "/workspace");
  assert.equal(projected.snapshotStale, true);
  assert.equal(projected.documents["src/a.ts"].content, updated.content);
  assert.equal(projected.commands.length, 1);
  assert.equal(projected.commands[0].isTest, true);
  assert.equal(projected.commands[0].exitCode, 0);
  const afterPatch = projectCoderWorkspace([...messages, { role: "assistant", parts: [{ type: "dynamic-tool", toolName: "coder_patch", toolCallId: "p", state: "output-available", output: { files: [{ path: "src/a.ts", operation: "update" }], diagnostics: [{ check: "syntax", message: "Broken", path: "src/a.ts", line: 1 }] } }] }]);
  assert.equal(afterPatch.documents["src/a.ts"], undefined);
  assert.equal(afterPatch.diagnostics[0].message, "Broken");
});

test("the first model turn memoizes mode even if later request metadata differs", async () => {
  let memoized;
  const ctx = {
    session: { auth: { current: { attributes: { "tflash:mode": "coder" } } } },
    memo: async (_key, resolve) => {
      if (memoized === undefined) memoized = await resolve();
      return memoized;
    },
  };
  assert.equal(await sessionAgentMode(ctx), "coder");
  ctx.session.auth.current.attributes["tflash:mode"] = "chat";
  assert.equal(await sessionAgentMode(ctx), "coder");
});

test("repository clone accepts only credential-free public HTTPS repository URLs", () => {
  assert.equal(normalizeRepositoryUrl("https://github.com/owner/repo"), "https://github.com/owner/repo");
  assert.equal(normalizeRepositoryUrl("https://gitlab.com/group/project.git/"), "https://gitlab.com/group/project.git");
  for (const url of [
    "http://github.com/owner/repo", "file:///tmp/repo", "git@github.com:owner/repo.git",
    "https://user:secret@github.com/owner/repo", "https://localhost/owner/repo",
    "https://github.com/owner", "https://github.com/owner/repo?x=1", "https://github.com:444/owner/repo",
  ]) assert.throws(() => normalizeRepositoryUrl(url), undefined, url);
  assert.equal(shellQuote("https://github.com/owner/it'is"), `'https://github.com/owner/it'"'"'is'`);
});
