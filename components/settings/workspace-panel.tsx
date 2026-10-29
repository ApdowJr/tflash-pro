"use client";

import { useState, type FormEvent } from "react";
import { useAppSettings } from "./app-settings";
import { useWorkspace } from "./workspace-store";
import {
  assignProject,
  deleteProject,
  type Project,
  type MemoryNote,
} from "@/lib/workspace";
import { downloadBlob } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const textClass = "w-full rounded-md border bg-background p-2 text-sm";
export function WorkspacePanel() {
  const { workspace, ready, storageError, change, clear } = useWorkspace();
  const { settings, t } = useAppSettings();
  const [project, setProject] = useState<Project>();
  const [note, setNote] = useState<MemoryNote>();
  const [deleting, setDeleting] = useState<{
    type: "project" | "note" | "all";
    id: string;
  }>();
  const [error, setError] = useState(false);
  function run(fn: () => void) {
    try {
      fn();
      setError(false);
    } catch {
      setError(true);
    }
  }
  function saveProject(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    run(() => {
      change((w) => ({
        ...w,
        projects: [...w.projects.filter((p) => p.id !== project.id), project],
      }));
      setProject(undefined);
    });
  }
  function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!note) return;
    run(() => {
      change((w) => ({
        ...w,
        notes: [...w.notes.filter((n) => n.id !== note.id), note],
      }));
      setNote(undefined);
    });
  }
  if (!ready) return <p>{t("loadingChat")}</p>;
  return (
    <section className="space-y-5" aria-label={t("workspace")}>
      <p className="text-xs text-muted-foreground">{t("workspaceLocal")}</p>
      {storageError ? (
        <p role="alert" className="text-xs text-destructive">
          {t("workspaceLoadFailed")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("workspaceFailed")}
        </p>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t("projects")}</h3>
        {workspace.projects.map((p) => (
          <div className="rounded-md border p-3" key={p.id}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-sm">
                {p.name}
              </span>
              <Button size="sm" variant="outline" onClick={() => setProject(p)}>
                {t("editProject")}
              </Button>
              <Button
                aria-label={`${t("remove")}: ${p.name}`}
                size="sm"
                variant="ghost"
                onClick={() => setDeleting({ type: "project", id: p.id })}
              >
                {t("remove")}
              </Button>
            </div>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer">
                {t("projectChats")} ({p.chatIds.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {p.chatIds.map((id) => (
                  <li key={id}>
                    <a
                      className="break-words underline"
                      href={`/s/${encodeURIComponent(id)}`}
                    >
                      {settings.chats.find((c) => c.id === id)?.title ?? id}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
        <Button
          disabled={workspace.projects.length >= 20}
          size="sm"
          variant="outline"
          onClick={() =>
            setProject({
              id: crypto.randomUUID(),
              name: "",
              instructions: "",
              chatIds: [],
            })
          }
        >
          {t("newProject")}
        </Button>
        {project ? (
          <form
            onSubmit={saveProject}
            className="space-y-2 rounded-md border p-3"
          >
            <label className="block text-xs">
              {t("projectName")}
              <Input
                required
                maxLength={80}
                value={project.name}
                onChange={(e) =>
                  setProject({ ...project, name: e.target.value })
                }
              />
            </label>
            <label className="block text-xs">
              {t("projectInstructions")}
              <textarea
                className={textClass}
                rows={4}
                maxLength={4000}
                value={project.instructions}
                onChange={(e) =>
                  setProject({ ...project, instructions: e.target.value })
                }
              />
            </label>
            <div className="flex gap-2">
              <Button size="sm" type="submit">
                {t("save")}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setProject(undefined)}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">{t("memory")}</h3>
        <p className="text-xs text-muted-foreground">{t("memoryHint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={workspace.memoryEnabled}
            onChange={(e) =>
              run(() =>
                change((w) => ({ ...w, memoryEnabled: e.target.checked })),
              )
            }
          />
          {t("memoryEnabled")}
        </label>
        {workspace.notes.map((n) => (
          <div className="space-y-2 rounded-md border p-3" key={n.id}>
            <p className="whitespace-pre-wrap break-words text-sm">{n.text}</p>
            <p className="text-xs text-muted-foreground">
              {workspace.projects.find((p) => p.id === n.projectId)?.name ??
                t("globalMemory")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={n.enabled}
                  onChange={(e) =>
                    run(() =>
                      change((w) => ({
                        ...w,
                        notes: w.notes.map((item) =>
                          item.id === n.id
                            ? { ...item, enabled: e.target.checked }
                            : item,
                        ),
                      })),
                    )
                  }
                />
                {t("noteEnabled")}
              </label>
              <Button size="sm" variant="outline" onClick={() => setNote(n)}>
                {t("editMemory")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${t("remove")}: ${n.text.slice(0, 40)}`}
                onClick={() => setDeleting({ type: "note", id: n.id })}
              >
                {t("remove")}
              </Button>
            </div>
          </div>
        ))}
        <Button
          disabled={workspace.notes.length >= 30}
          size="sm"
          variant="outline"
          onClick={() =>
            setNote({
              id: crypto.randomUUID(),
              text: "",
              enabled: true,
              projectId: null,
            })
          }
        >
          {t("addMemory")}
        </Button>
        {note ? (
          <form onSubmit={saveNote} className="space-y-2 rounded-md border p-3">
            <label className="block text-xs">
              {t("memoryText")}
              <textarea
                required
                className={textClass}
                rows={3}
                maxLength={1000}
                value={note.text}
                onChange={(e) => setNote({ ...note, text: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              {t("projects")}
              <select
                className={textClass}
                value={note.projectId ?? ""}
                onChange={(e) =>
                  setNote({ ...note, projectId: e.target.value || null })
                }
              >
                <option value="">{t("globalMemory")}</option>
                {workspace.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button size="sm" type="submit">
                {t("save")}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setNote(undefined)}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">{t("usageLimits")}</h3>
        <label className="block text-xs">
          {t("maxModelSteps")}
          <select
            className={textClass}
            value={workspace.maxSteps}
            onChange={(e) =>
              run(() =>
                change((w) => ({ ...w, maxSteps: Number(e.target.value) })),
              )
            }
          >
            {Array.from({ length: 30 }, (_, i) => (
              <option key={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{t("limitHint")}</p>
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(() =>
              downloadBlob(
                new Blob([JSON.stringify(workspace, null, 2)], {
                  type: "application/json",
                }),
                "tflash-workspace.json",
              ),
            )
          }
        >
          {t("exportWorkspace")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeleting({ type: "all", id: "all" })}
        >
          {t("clearWorkspace")}
        </Button>
      </div>
      {deleting ? (
        <div
          role="alertdialog"
          aria-label={t("remove")}
          className="space-y-2 rounded-md border p-3"
        >
          <p className="text-sm">{t("deleteWorkspaceItem")}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                run(() => {
                  if (deleting.type === "all") clear();
                  else
                    change((w) =>
                      deleting.type === "project"
                        ? deleteProject(w, deleting.id)
                        : {
                            ...w,
                            notes: w.notes.filter((n) => n.id !== deleting.id),
                          },
                    );
                  setDeleting(undefined);
                  setNote(undefined);
                  setProject(undefined);
                })
              }
            >
              {t("remove")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleting(undefined)}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ProjectPicker({
  sessionId,
  disabled,
}: {
  sessionId?: string;
  disabled?: boolean;
}) {
  const { workspace, ready, change } = useWorkspace();
  const { t } = useAppSettings();
  const [error, setError] = useState(false);
  if (!workspace.projects.length) return null;
  return (
    <div className="mb-2 text-xs">
      <label className="flex items-center gap-2">
        {t("projects")}
        <select
          className="max-w-56 min-w-0 rounded-md border bg-background p-1"
          disabled={!ready || !sessionId || disabled}
          value={
            workspace.projects.find((p) => p.chatIds.includes(sessionId ?? ""))
              ?.id ?? ""
          }
          onChange={(e) => {
            try {
              change((w) =>
                assignProject(w, sessionId!, e.target.value || null),
              );
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          <option value="">{t("noProject")}</option>
          {workspace.projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p role="alert">{t("workspaceFailed")}</p> : null}
    </div>
  );
}
