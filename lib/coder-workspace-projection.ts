import {
  coderWorkspaceReadSchema,
  coderWorkspaceSnapshotSchema,
  coderWorkspaceWriteSchema,
  isTestCommand,
  normalizeWorkspacePath,
  type CoderWorkspaceRead,
  type CoderWorkspaceSnapshot,
} from "@/lib/coder-workspace";

export type CoderCommand = {
  readonly id: string;
  readonly command: string;
  readonly state: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
  readonly truncated: boolean;
  readonly isTest: boolean;
  readonly error?: string;
};

export type CoderDiagnostic = {
  readonly check: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly code?: number;
};

export type CoderWorkspaceProjection = {
  readonly snapshot?: CoderWorkspaceSnapshot;
  readonly snapshotStale: boolean;
  readonly documents: Readonly<Record<string, CoderWorkspaceRead>>;
  readonly commands: readonly CoderCommand[];
  readonly diagnostics: readonly CoderDiagnostic[];
};

type MessagePart = {
  readonly type: string;
  readonly name?: string;
  readonly toolName?: string;
  readonly callId?: string;
  readonly toolCallId?: string;
  readonly state?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly partial?: boolean;
  readonly error?: { message?: string };
  readonly errorText?: string;
};

type Message = { readonly role: string; readonly parts: readonly MessagePart[] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function settled(part: MessagePart): boolean {
  return (part.state === "output-available" || part.state === "completed") && part.partial !== true;
}

function commandState(part: MessagePart, output: Record<string, unknown> | undefined): string {
  if (output?.status === "running") return "running";
  if (part.state === "completed" || part.state === "output-available") {
    // Eve rc.6 can settle a nonzero shell exit as completed with errorText.
    if (output?.status === "completed" && typeof output.exitCode === "number" && output.exitCode !== 0) return "failed";
    if (typeof part.errorText === "string" && part.errorText.length > 0) return "failed";
    if (typeof part.error?.message === "string" && part.error.message.length > 0) return "failed";
    return "completed";
  }
  if (part.state === "failed" || part.state === "output-error") return "failed";
  if (part.state === "rejected" || part.state === "output-denied") return "rejected";
  if (part.state === "cancelled") return "cancelled";
  if (part.state === "approval" || part.state === "approval-requested") return "approval";
  return "pending";
}

function diagnosticsFrom(output: unknown): CoderDiagnostic[] {
  const values = record(output)?.diagnostics;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const item = record(value);
    if (!item || typeof item.message !== "string" || typeof item.check !== "string") return [];
    return [{
      check: item.check,
      message: item.message,
      ...(typeof item.path === "string" ? { path: item.path } : {}),
      ...(typeof item.line === "number" ? { line: item.line } : {}),
      ...(typeof item.column === "number" ? { column: item.column } : {}),
      ...(typeof item.code === "number" ? { code: item.code } : {}),
    }];
  });
}

/** Fold only observed tool calls into IDE state; never infer edits from assistant prose. */
export function projectCoderWorkspace(messages: readonly Message[]): CoderWorkspaceProjection {
  let snapshot: CoderWorkspaceSnapshot | undefined;
  let snapshotStale = false;
  let diagnostics: CoderDiagnostic[] = [];
  const documents = new Map<string, CoderWorkspaceRead>();
  const commands: CoderCommand[] = [];
  const invalidateDocument = (value: string) => {
    documents.delete(value);
    try { documents.delete(normalizeWorkspacePath(value)); } catch { /* absolute/home paths are not editor documents */ }
    const root = snapshot?.workspaceRoot;
    if (root && value.startsWith(`${root}/`)) {
      try { documents.delete(normalizeWorkspacePath(value.slice(root.length + 1))); } catch { /* not an editor-visible path */ }
    }
  };

  messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") return;
    message.parts.forEach((part, partIndex) => {
      if (part.type !== "tool" && part.type !== "dynamic-tool") return;
      const name = part.toolName ?? part.name;
      if (!name) return;
      const id = part.toolCallId ?? part.callId ?? `${messageIndex}:${partIndex}`;
      const input = record(part.input);
      const output = record(part.output);

      if (name === "bash") {
        const command = typeof input?.command === "string" ? input.command : "Command input unavailable";
        commands.push({
          id,
          command,
          state: commandState(part, output),
          stdout: typeof output?.stdout === "string" ? output.stdout : "",
          stderr: typeof output?.stderr === "string" ? output.stderr : "",
          ...(typeof output?.exitCode === "number" ? { exitCode: output.exitCode } : {}),
          truncated: output?.truncated === true,
          isTest: isTestCommand(command),
          ...(typeof part.errorText === "string" || typeof part.error?.message === "string"
            ? { error: part.errorText ?? part.error?.message } : {}),
        });
        return;
      }
      if (!settled(part)) return;

      if (name === "coder_workspace_snapshot" || name === "coder_repository_clone") {
        const parsed = coderWorkspaceSnapshotSchema.safeParse(part.output);
        if (parsed.success) { snapshot = parsed.data; snapshotStale = false; }
      } else if (name === "coder_workspace_read") {
        const parsed = coderWorkspaceReadSchema.safeParse(part.output);
        if (parsed.success) documents.set(parsed.data.path, parsed.data);
      } else if (name === "coder_workspace_write") {
        const parsed = coderWorkspaceWriteSchema.safeParse(part.output);
        if (parsed.success) {
          documents.set(parsed.data.file.path, parsed.data.file);
          snapshotStale = true;
        }
      } else if (name === "coder_patch" || name === "code__apply_patch") {
        snapshotStale = true;
        // rc.6 edit_file returns { path, replacements }; older apply_patch
        // results may still carry files/diagnostics. Invalidate cached reads
        // either way so the editor never shows pre-edit content as current.
        diagnostics = diagnosticsFrom(part.output);
        const editedPath = record(part.output)?.path;
        if (typeof editedPath === "string") invalidateDocument(editedPath);
        const files = record(part.output)?.files;
        if (Array.isArray(files)) {
          for (const value of files) {
            const file = record(value);
            for (const raw of [file?.path, file?.previousPath]) {
              if (typeof raw !== "string") continue;
              try { documents.delete(normalizeWorkspacePath(raw)); } catch { /* Ignore invalid foreign output. */ }
            }
          }
        }
      }
    });
  });

  return { snapshot, snapshotStale, documents: Object.fromEntries(documents), commands, diagnostics };
}
