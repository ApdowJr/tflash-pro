import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, exec } from "node:child_process";
import { promisify } from "node:util";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const tool = (await import("../agent/tools/inspect_coding_workspace.ts")).default;
const execute = promisify(exec);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
function sandbox(cwd, override) {
  return {
    resolvePath: () => cwd,
    async run(options) {
      if (override) return override(options);
      try {
        const result = await execute(options.command, { cwd, env: { ...process.env, ...options.env }, signal: options.abortSignal });
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        if (error.name === "AbortError") throw error;
        return { exitCode: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
      }
    },
  };
}
const context = (box, signal = new AbortController().signal) => ({ getSandbox: async () => box, abortSignal: signal });

test("inspection requires fresh approval for every call", async () => {
  assert.equal(tool.availableInSubagents, false);
  for (const approvedTools of [[], ["inspect_coding_workspace"]])
    assert.equal(await tool.approval({ approvedTools, toolName: "inspect_coding_workspace", toolInput: {} }), "user-approval");
});

test("reports real local Git metadata and tracked changes without treating untracked files as clean proof", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "tflash-git-"));
  try {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.test");
    writeFileSync(join(cwd, "file.txt"), "original\n");
    git(cwd, "add", "file.txt"); git(cwd, "commit", "-qm", "initial");
    const head = git(cwd, "rev-parse", "HEAD");
    writeFileSync(join(cwd, "new.txt"), "untracked\n");
    let result = await tool.execute({}, context(sandbox(cwd)));
    assert.equal(result.status, "observed"); assert.equal(result.revision, head);
    assert.deepEqual(result.trackedChanges, { staged: false, unstaged: false });
    assert.match(result.limitation, /Untracked and ignored files were not inspected/);
    writeFileSync(join(cwd, "file.txt"), "staged\n"); git(cwd, "add", "file.txt");
    writeFileSync(join(cwd, "file.txt"), "unstaged\n");
    result = await tool.execute({}, context(sandbox(cwd)));
    assert.deepEqual(result.trackedChanges, { staged: true, unstaged: true });
    git(cwd, "checkout", "--detach", "-q");
    result = await tool.execute({}, context(sandbox(cwd)));
    assert.equal(result.branch, null);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("missing repository, invalid HEAD and changing HEAD never produce a success", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "tflash-nogit-"));
  try {
    assert.equal((await tool.execute({}, context(sandbox(cwd)))).status, "unavailable");
    git(cwd, "init", "-q");
    assert.equal((await tool.execute({}, context(sandbox(cwd)))).status, "unavailable");
    let heads = 0;
    const fake = sandbox(cwd, async ({ command }) => {
      if (command.includes("show-toplevel")) return { exitCode: 0, stdout: cwd + "\n", stderr: "" };
      if (command.includes("verify HEAD")) return { exitCode: 0, stdout: (++heads === 1 ? "a" : "b").repeat(40), stderr: "" };
      if (command.includes("symbolic-ref")) return { exitCode: 0, stdout: "main\n", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    assert.match((await tool.execute({}, context(fake))).message, /HEAD changed/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("diff errors and cancellation fail closed", async () => {
  const cwd = "/workspace";
  const box = sandbox(cwd, async ({ command }) => {
    if (command.includes("show-toplevel")) return { exitCode: 0, stdout: cwd, stderr: "" };
    if (command.includes("verify HEAD")) return { exitCode: 0, stdout: "a".repeat(40), stderr: "" };
    if (command.includes("symbolic-ref")) return { exitCode: 0, stdout: "main", stderr: "" };
    return { exitCode: 128, stdout: "", stderr: "error" };
  });
  assert.equal((await tool.execute({}, context(box))).status, "unavailable");
  const controller = new AbortController(); controller.abort(new Error("stopped"));
  await assert.rejects(tool.execute({}, context(box, controller.signal)), /stopped/);
});
