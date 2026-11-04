import { z } from "zod";

export const CODER_WORKSPACE_VERSION = 1;
export const CODER_FILE_LIMIT = 200_000;
export const CODER_DIFF_LIMIT = 60_000;
export const CODER_SNAPSHOT_FILE_LIMIT = 300;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const workspacePathSchema = z.string().min(1).max(240);

export const coderRepositoryChangeSchema = z.object({
  path: z.string().min(1).max(500),
  status: z.string().length(2),
  previousPath: z.string().min(1).max(500).optional(),
}).strict();

export const coderRepositorySchema = z.object({
  isRepository: z.boolean(),
  root: z.string().optional(),
  branch: z.string().max(255).optional(),
  revision: z.string().max(64).optional(),
  changes: z.array(coderRepositoryChangeSchema).max(200),
  changesTruncated: z.boolean(),
}).strict();

export const coderWorkspaceSnapshotSchema = z.object({
  kind: z.literal("coder-workspace-snapshot"),
  version: z.literal(CODER_WORKSPACE_VERSION),
  workspaceRoot: z.string().min(1).max(500),
  files: z.array(z.object({ path: workspacePathSchema }).strict()).max(CODER_SNAPSHOT_FILE_LIMIT),
  filesTruncated: z.boolean(),
  repository: coderRepositorySchema,
  diff: z.string().max(CODER_DIFF_LIMIT),
  diffTruncated: z.boolean(),
  warnings: z.array(z.string().max(300)).max(4),
  capturedAt: z.string().datetime(),
}).strict();

export const coderWorkspaceReadSchema = z.object({
  kind: z.literal("coder-workspace-read"),
  version: z.literal(CODER_WORKSPACE_VERSION),
  path: workspacePathSchema,
  content: z.string().max(CODER_FILE_LIMIT),
  sha256: sha256Schema,
  bytes: z.number().int().nonnegative().max(100_000_000),
  totalLines: z.number().int().nonnegative().max(10_000_000),
  truncated: z.boolean(),
}).strict();

export const coderWorkspaceWriteSchema = z.object({
  kind: z.literal("coder-workspace-write"),
  version: z.literal(CODER_WORKSPACE_VERSION),
  file: coderWorkspaceReadSchema,
  previousSha256: sha256Schema.nullable(),
}).strict();

export const coderWorkspaceSnapshotInputSchema = z.object({}).strict();
export const coderWorkspaceReadInputSchema = z.object({ path: workspacePathSchema }).strict();
export const coderWorkspaceWriteInputSchema = z.object({
  path: workspacePathSchema,
  content: z.string().max(CODER_FILE_LIMIT),
  /** Null means the caller expects to create a file that does not exist yet. */
  expectedSha256: sha256Schema.nullable(),
}).strict();

export type CoderRepositoryChange = z.infer<typeof coderRepositoryChangeSchema>;
export type CoderRepository = z.infer<typeof coderRepositorySchema>;
export type CoderWorkspaceSnapshot = z.infer<typeof coderWorkspaceSnapshotSchema>;
export type CoderWorkspaceRead = z.infer<typeof coderWorkspaceReadSchema>;
export type CoderWorkspaceWrite = z.infer<typeof coderWorkspaceWriteSchema>;

/** Normalize a user/model supplied sandbox path and reject secrets/control paths. */
export function normalizeWorkspacePath(value: string): string {
  if (!value || value.length > 240 || value.includes("\\") || value.includes("\0")) {
    throw new Error("Use a short workspace-relative file path.");
  }
  if (value.startsWith("/") || value.startsWith("$HOME") || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("Absolute paths, home paths, and control characters are not allowed.");
  }
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") throw new Error("Parent path traversal is not allowed.");
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error("Choose a file inside the workspace.");
  if (segments.some((segment) => segment === ".git" || segment === ".eve")) {
    throw new Error("Git and Eve internal files are not exposed in the workspace editor.");
  }
  const basename = segments.at(-1)!.toLowerCase();
  if (/^\.env(?:\..+)?$/.test(basename) && basename !== ".env.example" && basename !== ".env.sample") {
    throw new Error("Environment secret files are not exposed in the workspace editor.");
  }
  return segments.join("/");
}

export function isVisibleWorkspacePath(value: string): boolean {
  try {
    return normalizeWorkspacePath(value) === value;
  } catch {
    return false;
  }
}

/** Parse Git's short porcelain output without treating it as a synchronization proof. */
export function parseGitStatus(output: string): CoderRepositoryChange[] {
  const changes: CoderRepositoryChange[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 4 || line.startsWith("## ")) continue;
    const status = line.slice(0, 2);
    const rawPath = line.slice(3);
    if (!rawPath) continue;
    const rename = rawPath.indexOf(" -> ");
    const previousPath = rename >= 0 ? rawPath.slice(0, rename) : undefined;
    const path = rename >= 0 ? rawPath.slice(rename + 4) : rawPath;
    changes.push({ status, path, ...(previousPath ? { previousPath } : {}) });
  }
  return changes;
}

export function isTestCommand(command: string): boolean {
  if (/(?:^|\s)(?:pytest|vitest|jest)(?:\s|$)/i.test(command)) return true;
  return /(?:^|\s)(?:pnpm|npm|yarn|bun|deno|go|cargo|dotnet|mvn|gradle)(?:\s|$)/i.test(command)
    && /\b(?:test|spec|check|verify|typecheck|tsc|lint)\b/i.test(command);
}

export function languageForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "html", py: "python",
    sh: "bash", bash: "bash", yml: "yaml", yaml: "yaml", sql: "sql",
  } as Record<string, string>)[extension ?? ""] ?? "text";
}

export function truncateText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(0, limit), truncated: true };
}
