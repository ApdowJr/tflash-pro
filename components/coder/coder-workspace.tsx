"use client";

import { AgentPlanCard } from "@/components/chat/agent-workspace";
import { Button } from "@/components/ui/button";
import type { AgentPlan } from "@/lib/agent-workspace";
import {
  languageForPath,
  normalizeWorkspacePath,
  type CoderRepositoryChange,
} from "@/lib/coder-workspace";
import type { CoderCommand, CoderWorkspaceProjection } from "@/lib/coder-workspace-projection";
import { normalizeRepositoryUrl } from "@/lib/repository";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileCode2Icon,
  FilePlus2Icon,
  FilesIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type WorkspaceTab = "code" | "changes" | "terminal" | "plan";
type Draft = { content: string; baseSha256: string | null; sent: boolean };

type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
};

function fileTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const path of paths) {
    let parent = root;
    const segments = path.split("/");
    segments.forEach((name, index) => {
      const nodePath = segments.slice(0, index + 1).join("/");
      if (!parent.children.has(name)) parent.children.set(name, { name, path: nodePath, children: new Map() });
      parent = parent.children.get(name)!;
    });
  }
  return root;
}

function sortedNodes(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const directoryDifference = Number(b.children.size > 0) - Number(a.children.size > 0);
    return directoryDifference || a.name.localeCompare(b.name);
  });
}

function TreeItems({ node, depth, selectedPath, onSelect }: {
  readonly node: TreeNode;
  readonly depth: number;
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
}) {
  return <>
    {sortedNodes(node).map((child) => child.children.size > 0
      ? <DirectoryItem key={child.path} node={child} depth={depth} selectedPath={selectedPath} onSelect={onSelect} />
      : <li key={child.path}>
          <button
            aria-current={selectedPath === child.path ? "page" : undefined}
            className={cn(
              "flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              selectedPath === child.path && "bg-accent text-foreground",
            )}
            onClick={() => onSelect(child.path)}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            type="button"
          >
            <FileCode2Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{child.name}</span>
          </button>
        </li>)}
  </>;
}

function DirectoryItem({ node, depth, selectedPath, onSelect }: {
  readonly node: TreeNode;
  readonly depth: number;
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return <li>
    <button
      aria-expanded={open}
      className="flex min-h-8 w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => setOpen((value) => !value)}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      type="button"
    >
      {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
      <span className="truncate">{node.name}</span>
    </button>
    {open ? <ul className="space-y-0.5"><TreeItems node={node} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} /></ul> : null}
  </li>;
}

function DiffView({ diff }: { readonly diff: string }) {
  return <pre aria-label="Workspace diff" className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/25 p-3 font-mono text-[11px] leading-5">
    {diff.split("\n").map((line, index) => <span
      className={cn("block whitespace-pre", line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300", line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10 text-red-800 dark:text-red-300", line.startsWith("@@") && "text-brand")}
      key={`${index}:${line.slice(0, 30)}`}
    >{line || " "}</span>)}
  </pre>;
}

function CommandResult({ command, defaultOpen }: { readonly command: CoderCommand; readonly defaultOpen: boolean }) {
  const succeeded = command.state === "completed" && command.exitCode === 0;
  return <details className="rounded-md border bg-card" open={defaultOpen}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", succeeded ? "bg-emerald-500" : command.state === "completed" ? "bg-red-500" : "bg-amber-500")} />
      <code className="min-w-0 flex-1 break-all text-[11px]">{command.command}</code>
      {command.isTest ? <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">check</span> : null}
      <span className="text-[10px] text-muted-foreground">{command.exitCode !== undefined ? `exit ${command.exitCode}` : command.state}</span>
    </summary>
    <div className="border-t p-3">
      {command.error ? <p className="mb-2 text-xs text-destructive" role="alert">{command.error}</p> : null}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{command.stdout || command.stderr || (command.state === "pending" ? "Waiting for a real command result…" : "No output")}</pre>
      {command.stderr && command.stdout ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words border-t pt-2 font-mono text-[11px] leading-5 text-destructive">{command.stderr}</pre> : null}
      {command.truncated ? <p className="mt-2 text-[10px] text-muted-foreground">Output was truncated by the shell tool.</p> : null}
    </div>
  </details>;
}

function ChangeRow({ change }: { readonly change: CoderRepositoryChange }) {
  return <li className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
    <span className={cn("w-5 font-mono font-medium", change.status.includes("?") ? "text-brand" : "text-muted-foreground")}>{change.status.trim() || "M"}</span>
    <span className="min-w-0 flex-1 break-all">{change.path}</span>
  </li>;
}

export function CoderWorkspace({
  projection,
  plan,
  isBusy,
  disabled = false,
  mobileVisible = false,
  pendingApprovals = 0,
  onCommand,
  onReviewApprovals,
}: {
  readonly projection: CoderWorkspaceProjection;
  readonly plan?: AgentPlan;
  readonly isBusy: boolean;
  readonly disabled?: boolean;
  readonly mobileVisible?: boolean;
  readonly pendingApprovals?: number;
  readonly onCommand: (text: string) => void;
  readonly onReviewApprovals: () => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("code");
  const [selectedPath, setSelectedPath] = useState<string>();
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileError, setNewFileError] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryError, setRepositoryError] = useState("");
  const snapshot = projection.snapshot;
  const documents = projection.documents;
  const document = selectedPath ? documents[selectedPath] : undefined;
  const draft = selectedPath ? drafts[selectedPath] : undefined;
  const readOnly = disabled || isBusy;
  const outdated = !!(draft && document && draft.baseSha256 !== document.sha256 && draft.content !== document.content);
  const dirty = !!(draft && (!document || draft.content !== document.content));
  const localPaths = Object.keys(drafts).filter((path) => !documents[path] && !snapshot?.files.some((file) => file.path === path));
  const allPaths = useMemo(() => [...new Set([...(snapshot?.files.map((file) => file.path) ?? []), ...Object.keys(documents), ...localPaths])], [snapshot, documents, localPaths.join("|")]);
  const visiblePaths = useMemo(() => allPaths.filter((path) => path.toLowerCase().includes(query.trim().toLowerCase())), [allPaths, query]);
  const tree = useMemo(() => fileTree(visiblePaths), [visiblePaths]);

  // A verified write replaces the corresponding local draft. Conflicting
  // drafts stay visible and must be explicitly discarded by the user.
  useEffect(() => {
    setDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const [path, value] of Object.entries(current)) {
        const observed = documents[path];
        if (observed && observed.sha256 !== value.baseSha256 && observed.content === value.content) {
          delete next[path]; changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [documents]);

  function selectFile(path: string) {
    setSelectedPath(path);
    setTab("code");
  }

  function loadFile(path = selectedPath) {
    if (!path || readOnly) return;
    onCommand(`Open this sandbox file for the Coder workspace. Call coder_workspace_read with ${JSON.stringify({ path })}. Do not edit files or run shell commands.`);
  }

  function syncWorkspace() {
    if (readOnly) return;
    const readAgain = selectedPath && document && !document.truncated
      ? ` Then call coder_workspace_read for ${JSON.stringify({ path: selectedPath })}.` : "";
    onCommand(`Refresh the Coder workspace: call coder_workspace_snapshot now.${readAgain} Do not edit files or run shell commands.`);
  }

  function createDraft() {
    try {
      const path = normalizeWorkspacePath(newFilePath.trim());
      if (allPaths.includes(path) || documents[path]) throw new Error("That file already exists. Open it instead.");
      setSelectedPath(path);
      setDrafts((current) => ({ ...current, [path]: { content: "", baseSha256: null, sent: false } }));
      setNewFileOpen(false); setNewFilePath(""); setNewFileError("");
    } catch (error) {
      setNewFileError(error instanceof Error ? error.message : "Enter a valid file path.");
    }
  }

  function cloneRepository() {
    if (readOnly) return;
    try {
      const url = normalizeRepositoryUrl(repositoryUrl.trim());
      setRepositoryError("");
      onCommand(`Clone this repository into the empty Coder sandbox. Call coder_repository_clone once with ${JSON.stringify({ url })}. Do not use bash as a substitute and do not push or change the remote repository.`);
    } catch (error) {
      setRepositoryError(error instanceof Error ? error.message : "Enter a valid public repository URL.");
    }
  }

  function runChecks() {
    if (readOnly) return;
    onCommand("Inspect the current repository scripts and test setup, then run the narrowest relevant existing checks for this task using the approved bash tool. Do not edit files merely to make checks pass. Report the exact commands, exit codes, and any checks that were unavailable.");
  }

  function applyDraft() {
    if (!selectedPath || !draft || !dirty || outdated || readOnly || document?.truncated) return;
    const input = { path: selectedPath, content: draft.content, expectedSha256: draft.baseSha256 };
    onCommand([
      "Apply my exact Coder editor draft. Call coder_workspace_write once with the JSON input below.",
      "Do not reformat, improve, or otherwise change the content. If the hash is stale, stop and read the file instead of overwriting it.",
      "```json", JSON.stringify(input), "```",
    ].join("\n"));
    setDrafts((current) => ({ ...current, [selectedPath]: { ...draft, sent: true } }));
  }

  const changesCount = snapshot?.repository.changes.length ?? 0;
  const testCount = projection.commands.filter((command) => command.isTest).length;
  const tabs = [
    { id: "code" as const, label: "Code", icon: FilesIcon },
    { id: "changes" as const, label: `Changes${changesCount ? ` ${changesCount}` : ""}`, icon: GitCompareArrowsIcon },
    { id: "terminal" as const, label: `Terminal${testCount ? ` · ${testCount} checks` : ""}`, icon: SquareTerminalIcon },
    { id: "plan" as const, label: "Plan", icon: ListTodoIcon },
  ];

  return <section aria-label="Coder workspace" data-coder-workspace className={cn(
    "min-h-0 min-w-0 flex-col border-t bg-muted/10 xl:flex xl:border-t-0 xl:border-l",
    mobileVisible ? "flex flex-1" : "hidden",
  )}>
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Workspace</h2>
          {projection.snapshotStale ? <span className="text-[10px] text-amber-700 dark:text-amber-300">refresh available</span> : null}
        </div>
        <p className="truncate text-[10px] text-muted-foreground" title={snapshot?.workspaceRoot}>
          {snapshot ? snapshot.workspaceRoot : "No sandbox observation yet"}
        </p>
      </div>
      {snapshot?.repository.isRepository ? <span className="flex max-w-40 items-center gap-1 rounded-md border px-2 py-1 text-[10px] text-muted-foreground">
        <GitBranchIcon className="size-3 shrink-0" /><span className="truncate">{snapshot.repository.branch ?? "detached HEAD"}</span>
      </span> : null}
      {pendingApprovals > 0 ? <Button className="h-8 text-[11px]" onClick={onReviewApprovals} size="sm" type="button" variant="outline">{pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"}</Button> : null}
      <Button aria-label="Refresh workspace" className="size-8" disabled={readOnly} onClick={syncWorkspace} size="icon" title="Ask Coder for a fresh sandbox observation" type="button" variant="ghost">
        <RefreshCwIcon className={cn("size-4", isBusy && "animate-spin")} />
      </Button>
    </header>

    <div aria-label="Workspace views" className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-2 py-1.5" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => <button
        aria-selected={tab === id}
        className={cn("flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", tab === id && "bg-accent text-foreground")}
        key={id}
        onClick={() => setTab(id)}
        onKeyDown={(event) => {
          const currentIndex = tabs.findIndex((item) => item.id === id);
          let nextIndex = currentIndex;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = tabs.length - 1;
          else return;
          event.preventDefault();
          const nextTab = tabs[nextIndex];
          if (nextTab) {
            setTab(nextTab.id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
          }
        }}
        role="tab"
        tabIndex={tab === id ? 0 : -1}
        type="button"
      ><Icon className="size-3.5" />{label}</button>)}
    </div>

    {snapshot?.warnings.map((warning) => <p className="shrink-0 border-b bg-amber-500/5 px-3 py-1.5 text-[10px] text-amber-800 dark:text-amber-300" key={warning} role="status">{warning}</p>)}

    {!snapshot && (tab === "code" || tab === "changes") ? <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <FilesIcon className="mx-auto mb-3 size-6 text-muted-foreground" />
        <h3 className="text-sm font-medium">Inspect the real sandbox</h3>
        <p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">Coder starts with an isolated workspace, not an automatic copy of your GitHub repository. Load its actual files and Git state before editing.</p>
        <Button className="mt-4" disabled={readOnly} onClick={syncWorkspace} size="sm" type="button">Inspect sandbox</Button>
      </div>
    </div> : null}

    {snapshot && tab === "code" ? <div className="grid min-h-0 flex-1 grid-cols-[minmax(130px,0.34fr)_minmax(0,1fr)]">
      <aside className="flex min-h-0 min-w-0 flex-col border-r bg-background/60">
        <div className="flex items-center gap-1 border-b p-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Filter workspace files</span>
            <SearchIcon className="absolute top-2 left-2 size-3 text-muted-foreground" />
            <input className="h-7 w-full rounded border bg-background pr-1 pl-6 text-[16px] outline-none sm:text-[11px] focus:ring-1 focus:ring-ring" onChange={(event) => setQuery(event.target.value)} placeholder="Filter files" value={query} />
          </label>
          <Button aria-label="New file draft" className="size-7" onClick={() => setNewFileOpen((value) => !value)} size="icon" type="button" variant="ghost"><FilePlus2Icon className="size-3.5" /></Button>
        </div>
        {newFileOpen ? <div className="space-y-1 border-b p-2">
          <input aria-label="New file path" className="h-8 w-full rounded border bg-background px-2 font-mono text-[16px] sm:text-[11px]" onChange={(event) => setNewFilePath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createDraft(); }} placeholder="src/example.ts" value={newFilePath} />
          <Button className="h-7 w-full text-[11px]" onClick={createDraft} size="sm" type="button" variant="outline">Create local draft</Button>
          {newFileError ? <p className="text-[10px] text-destructive" role="alert">{newFileError}</p> : null}
        </div> : null}
        <nav aria-label="Workspace files" className="tflash-scroll min-h-0 flex-1 overflow-auto p-1.5">
          {visiblePaths.length ? <ul className="space-y-0.5"><TreeItems node={tree} depth={0} selectedPath={selectedPath} onSelect={selectFile} /></ul> : <p className="p-3 text-xs text-muted-foreground">No matching files.</p>}
        </nav>
        {snapshot.filesTruncated ? <p className="border-t p-2 text-[10px] text-muted-foreground">File list is bounded; ask Coder to open a specific path.</p> : null}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col bg-background">
        {!selectedPath ? <div className="flex flex-1 items-center justify-center p-5 text-center text-xs text-muted-foreground">Select a file to inspect or edit it with Coder.</div> : <>
          <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1.5">
            <div className="min-w-0 flex-1"><p className="truncate font-mono text-[11px]">{selectedPath}</p><p className="text-[9px] text-muted-foreground">{languageForPath(selectedPath)}{document ? ` · ${document.totalLines} lines` : " · not loaded"}</p></div>
            {dirty ? <span className={cn("shrink-0 text-[10px]", outdated ? "text-destructive" : "text-amber-700 dark:text-amber-300")}>{outdated ? "workspace changed" : draft.sent && isBusy ? "awaiting application" : draft.sent ? "not applied" : "unsent draft"}</span> : null}
            {document && !dirty ? <CheckIcon aria-label="Editor matches observed file" className="size-3.5 text-emerald-600" /> : null}
          </div>
          {!document && !draft ? <div className="flex flex-1 items-center justify-center p-5"><div className="text-center"><p className="text-xs text-muted-foreground">This file is listed but its contents have not been loaded.</p><Button className="mt-3" disabled={readOnly} onClick={() => loadFile()} size="sm" type="button" variant="outline">Load with Coder</Button></div></div> : null}
          {document?.truncated ? <div className="flex flex-1 items-center justify-center p-5 text-center"><div><AlertTriangleIcon className="mx-auto mb-2 size-5 text-amber-600" /><p className="max-w-sm text-xs leading-5 text-muted-foreground">This file exceeds the 200,000 byte editor limit. The preview is truncated and writing is disabled.</p></div></div> : null}
          {(document && !document.truncated) || draft ? <>
            {outdated ? <div className="flex flex-wrap items-center gap-2 border-b bg-destructive/5 px-3 py-2 text-[11px] text-destructive" role="alert"><span className="min-w-0 flex-1">The observed file changed. Your draft was not applied.</span><Button className="h-7 text-[10px]" onClick={() => { if (window.confirm("Discard this local draft and load the observed file?")) setDrafts((current) => { const next = { ...current }; delete next[selectedPath]; return next; }); }} size="sm" type="button" variant="outline">Discard draft</Button></div> : null}
            <textarea
              aria-label={`Edit ${selectedPath}`}
              className="tflash-scroll min-h-0 flex-1 resize-none overflow-auto bg-background p-4 font-mono text-[16px] leading-6 text-foreground outline-none focus:ring-1 focus:ring-inset focus:ring-ring sm:text-[12px]"
              onChange={(event) => setDrafts((current) => ({ ...current, [selectedPath]: { content: event.target.value, baseSha256: draft?.baseSha256 ?? document?.sha256 ?? null, sent: false } }))}
              readOnly={outdated}
              spellCheck={false}
              value={draft?.content ?? document?.content ?? ""}
            />
            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">
              <p className="min-w-0 flex-1 text-[10px] text-muted-foreground">Local edits stay in this browser until Coder applies them and the write is verified.</p>
              <Button className="h-8 text-[11px]" disabled={!dirty || outdated || readOnly} onClick={applyDraft} size="sm" type="button">{isBusy && draft?.sent ? <LoaderCircleIcon className="animate-spin" /> : null}Ask Coder to apply</Button>
            </footer>
          </> : null}
        </>}
      </div>
    </div> : null}

    {snapshot && tab === "changes" ? <div className="flex min-h-0 flex-1 flex-col">
      <div className="max-h-48 shrink-0 overflow-auto border-b bg-background p-2">
        <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase">Observed Git status</p>
        {snapshot.repository.changes.length ? <ul>{snapshot.repository.changes.map((change) => <ChangeRow change={change} key={`${change.status}:${change.previousPath}:${change.path}`} />)}</ul> : <p className="p-2 text-xs text-muted-foreground">{snapshot.repository.isRepository ? "No changes in the latest observed status." : "This workspace is not a Git repository."}</p>}
      </div>
      {snapshot.diff ? <DiffView diff={snapshot.diff} /> : !snapshot.repository.isRepository ? <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md"><h3 className="text-sm font-medium">Clone a public repository</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Use a credential-free HTTPS URL from GitHub, GitLab, or Bitbucket. The sandbox must be empty, and cloning requires approval.</p><div className="mt-3 flex gap-2"><input aria-label="Public repository URL" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-[16px] outline-none sm:text-xs focus:ring-1 focus:ring-ring" onChange={(event) => setRepositoryUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") cloneRepository(); }} placeholder="https://github.com/owner/repository" value={repositoryUrl} /><Button className="h-9" disabled={readOnly || !repositoryUrl.trim()} onClick={cloneRepository} size="sm" type="button">Clone</Button></div>{repositoryError ? <p className="mt-2 text-xs text-destructive" role="alert">{repositoryError}</p> : null}</div>
      </div> : <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">No tracked diff in this observation. Untracked files appear in status only.</div>}
      {snapshot.diffTruncated ? <p className="shrink-0 border-t p-2 text-[10px] text-muted-foreground">Diff display is truncated at 60,000 characters.</p> : null}
    </div> : null}

    {tab === "terminal" ? <div className="tflash-scroll min-h-0 flex-1 space-y-2 overflow-auto p-3">
      <div className="flex items-center gap-3"><p className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">Real shell calls from this conversation. Exit 0 is observed command success, not a claim about a remote repository.</p><Button className="h-8 shrink-0 text-[11px]" disabled={readOnly} onClick={runChecks} size="sm" type="button" variant="outline">Run checks</Button></div>
      {projection.commands.length ? [...projection.commands].reverse().map((command, index) => <CommandResult command={command} defaultOpen={index === 0} key={command.id} />) : <div className="flex min-h-48 items-center justify-center text-center text-xs text-muted-foreground">No shell commands yet. Ask Coder to run a focused test or check.</div>}
    </div> : null}

    {tab === "plan" ? <div className="tflash-scroll min-h-0 flex-1 overflow-auto p-3">
      {plan ? <AgentPlanCard plan={plan} /> : <div className="flex min-h-48 items-center justify-center text-center"><div><ListTodoIcon className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-xs text-muted-foreground">No agent-reported plan yet. Substantial Coder tasks can use the plan tool.</p></div></div>}
      {projection.diagnostics.length ? <section className="mt-3 rounded-md border p-3"><h3 className="text-xs font-medium">Latest patch diagnostics</h3><ul className="mt-2 space-y-2">{projection.diagnostics.map((diagnostic, index) => <li className="text-[11px]" key={`${diagnostic.path}:${diagnostic.line}:${index}`}><span className="text-muted-foreground">{diagnostic.path ?? "workspace"}{diagnostic.line ? `:${diagnostic.line}` : ""}</span><p>{diagnostic.message}</p></li>)}</ul></section> : null}
    </div> : null}
  </section>;
}
