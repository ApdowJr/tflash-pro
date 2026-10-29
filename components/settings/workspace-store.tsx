"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  emptyWorkspace,
  workspaceSchema,
  workspaceStorageKey,
  type Workspace,
} from "@/lib/workspace";

type WorkspaceSyncStatus = "local" | "syncing" | "synced" | "conflict" | "error";
type ConflictChoice = "browser" | "cloud";
type CloudSnapshot = {
  storage: string;
  workspace: Workspace | null;
  updatedAt: string | null;
};
type WorkspaceStore = {
  workspace: Workspace;
  ready: boolean;
  storageError: boolean;
  syncStatus: WorkspaceSyncStatus;
  cloudEnabled: boolean;
  change: (fn: (current: Workspace) => Workspace) => void;
  snapshot: () => Workspace;
  clear: () => void;
  resolveConflict: (choice: ConflictChoice) => Promise<void>;
};
const Context = createContext<WorkspaceStore | null>(null);
const EXPECTED_USER_HEADER = "x-tflash-expected-user-id";

function parseCloudSnapshot(input: unknown): CloudSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid workspace response.");
  }
  const result = input as Record<string, unknown>;
  if (result.storage !== "cloud") {
    return { storage: typeof result.storage === "string" ? result.storage : "", workspace: null, updatedAt: null };
  }
  const updatedAt = result.updatedAt;
  if (updatedAt !== null && (typeof updatedAt !== "string" || updatedAt.length > 64 || !Number.isFinite(Date.parse(updatedAt)))) {
    throw new Error("Invalid workspace revision.");
  }
  if (result.workspace === null) {
    if (updatedAt !== null) throw new Error("Invalid empty workspace revision.");
    return { storage: "cloud", workspace: null, updatedAt: null };
  }
  if (updatedAt === null) throw new Error("Missing workspace revision.");
  return {
    storage: "cloud",
    workspace: workspaceSchema.parse(result.workspace),
    updatedAt: updatedAt as string,
  };
}

function parseWriteRevision(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid workspace response.");
  }
  const updatedAt = (input as Record<string, unknown>).updatedAt;
  if (typeof updatedAt !== "string" || updatedAt.length > 64 || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Missing workspace revision.");
  }
  return updatedAt;
}

function workspacesEqual(left: Workspace, right: Workspace): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Supabase users sync to their own RLS-protected row; Vercel users stay browser-local. */
export function WorkspaceProvider({
  kind,
  userId,
  children,
}: {
  kind: string;
  userId: string;
  children: ReactNode;
}) {
  const key = workspaceStorageKey(kind, userId);
  const [loaded, setLoaded] = useState<{ key: string; value: Workspace }>();
  const [storageError, setStorageError] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>(kind === "supabase" ? "syncing" : "local");
  const reference = useRef(loaded);
  const activeKey = useRef(key);
  const changeRevision = useRef(0);
  const syncSequence = useRef(0);
  const cloudRevision = useRef<string | null>(null);
  const conflictKey = useRef<string | null>(null);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  reference.current = loaded;
  activeKey.current = key;

  const syncCloud = useCallback((value: Workspace) => {
    if (kind !== "supabase") return Promise.resolve();
    const targetKey = key;
    const expectedUserId = userId;
    const sequence = ++syncSequence.current;
    if (activeKey.current === targetKey) setSyncStatus("syncing");
    const task = cloudQueue.current.catch(() => undefined).then(async () => {
      if (activeKey.current !== targetKey || sequence !== syncSequence.current) return;
      if (conflictKey.current === targetKey) {
        setSyncStatus("conflict");
        return;
      }
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [EXPECTED_USER_HEADER]: expectedUserId,
        },
        body: JSON.stringify({ workspace: value, expectedUpdatedAt: cloudRevision.current }),
        cache: "no-store",
      });
      if (activeKey.current !== targetKey) return;
      if (response.status === 409) {
        conflictKey.current = targetKey;
        setSyncStatus("conflict");
        return;
      }
      if (!response.ok) throw new Error("Workspace cloud sync failed.");
      const updatedAt = parseWriteRevision(await response.json());
      if (activeKey.current !== targetKey) return;
      cloudRevision.current = updatedAt;
      if (sequence === syncSequence.current) setSyncStatus("synced");
    });
    cloudQueue.current = task;
    return task.catch((error: unknown) => {
      if (activeKey.current === targetKey && sequence === syncSequence.current) setSyncStatus("error");
      throw error;
    });
  }, [key, kind, userId]);

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
    if (kind !== "supabase" || conflictKey.current !== key) return;
    const targetKey = key;
    const expectedUserId = userId;
    syncSequence.current += 1;
    setSyncStatus("syncing");
    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
        headers: { [EXPECTED_USER_HEADER]: expectedUserId },
      });
      if (activeKey.current !== targetKey) return;
      if (!response.ok) throw new Error("Workspace cloud sync unavailable.");
      const remote = parseCloudSnapshot(await response.json());
      if (activeKey.current !== targetKey || remote.storage !== "cloud") return;
      cloudRevision.current = remote.updatedAt;
      if (choice === "cloud") {
        const value = remote.workspace ?? emptyWorkspace();
        window.localStorage.setItem(key, JSON.stringify(value));
        reference.current = { key, value };
        setLoaded({ key, value });
        setStorageError(false);
        conflictKey.current = null;
        setSyncStatus("synced");
        return;
      }
      const local = reference.current?.key === key ? reference.current.value : emptyWorkspace();
      conflictKey.current = null;
      await syncCloud(local);
    } catch {
      if (activeKey.current === targetKey) {
        conflictKey.current = targetKey;
        setSyncStatus("conflict");
      }
    }
  }, [key, kind, syncCloud, userId]);

  useEffect(() => {
    let cancelled = false;
    cloudRevision.current = null;
    conflictKey.current = null;
    setSyncStatus(kind === "supabase" ? "syncing" : "local");
    const load = async () => {
      let localValue = emptyWorkspace();
      let localUsable = true;
      let localExists = false;
      try {
        const raw = window.localStorage.getItem(key);
        localExists = raw !== null;
        localValue = raw ? workspaceSchema.parse(JSON.parse(raw)) : emptyWorkspace();
        reference.current = { key, value: localValue };
        setLoaded({ key, value: localValue });
        setStorageError(false);
      } catch {
        // Try cloud recovery, but never overwrite a corrupt local value with an empty cloud row.
        localUsable = false;
        reference.current = { key, value: emptyWorkspace() };
        setLoaded(reference.current);
        setStorageError(true);
      }
      if (kind !== "supabase") return;
      const revisionAtStart = changeRevision.current;
      try {
        const response = await fetch("/api/workspace", {
          cache: "no-store",
          headers: { [EXPECTED_USER_HEADER]: userId },
        });
        if (!response.ok) throw new Error("Workspace cloud sync unavailable.");
        const result = parseCloudSnapshot(await response.json());
        if (cancelled || activeKey.current !== key) return;
        if (result.storage !== "cloud") { setSyncStatus("local"); return; }
        cloudRevision.current = result.updatedAt;
        const current = reference.current?.key === key ? reference.current.value : localValue;
        if (changeRevision.current !== revisionAtStart) {
          if (result.workspace && !workspacesEqual(current, result.workspace)) {
            conflictKey.current = key;
            setSyncStatus("conflict");
          } else if (result.workspace) {
            setSyncStatus("synced");
          } else {
            await syncCloud(current);
          }
          return;
        }
        if (result.workspace) {
          if (localUsable && localExists && !workspacesEqual(localValue, result.workspace)) {
            conflictKey.current = key;
            setSyncStatus("conflict");
            return;
          }
          if (!localUsable || !localExists) window.localStorage.setItem(key, JSON.stringify(result.workspace));
          reference.current = { key, value: result.workspace };
          setLoaded({ key, value: result.workspace });
          setStorageError(false);
          setSyncStatus("synced");
        } else if (localUsable) {
          await syncCloud(localValue);
        } else {
          setSyncStatus("error");
        }
      } catch {
        if (!cancelled && activeKey.current === key) setSyncStatus("error");
      }
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        // Keep the newest same-browser snapshot; revision checks prevent stale cloud writes.
        changeRevision.current += 1;
        try {
          const value = event.newValue === null
            ? emptyWorkspace()
            : workspaceSchema.parse(JSON.parse(event.newValue));
          reference.current = { key, value };
          setLoaded({ key, value });
          setStorageError(false);
          if (conflictKey.current === key) {
            setSyncStatus("conflict");
            return;
          }
          void syncCloud(value).catch(() => undefined);
        } catch {
          setStorageError(true);
          setSyncStatus("error");
        }
      } else if (event.key === null) {
        changeRevision.current += 1;
        void load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; window.removeEventListener("storage", onStorage); };
  }, [key, kind, syncCloud, userId]);

  const snapshot = useCallback(
    () => reference.current?.key === key ? reference.current.value : emptyWorkspace(),
    [key],
  );
  const change = useCallback((fn: (current: Workspace) => Workspace) => {
    if (reference.current?.key !== key) throw new Error("Workspace not loaded.");
    // Merge against the most recent disk value, not a stale tab snapshot.
    // Invalid data is never silently replaced by a normal edit.
    const raw = window.localStorage.getItem(key);
    const current = raw ? workspaceSchema.parse(JSON.parse(raw)) : emptyWorkspace();
    const value = workspaceSchema.parse(fn(current));
    // Keep a local recovery copy, then queue the account-scoped cloud write.
    window.localStorage.setItem(key, JSON.stringify(value));
    changeRevision.current += 1;
    reference.current = { key, value };
    setLoaded({ key, value });
    setStorageError(false);
    void syncCloud(value).catch(() => undefined);
  }, [key, syncCloud]);
  const clear = useCallback(() => {
    if (reference.current?.key !== key) throw new Error("Workspace not loaded.");
    const value = emptyWorkspace();
    if (kind === "supabase") window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
    changeRevision.current += 1;
    reference.current = { key, value };
    setLoaded(reference.current);
    setStorageError(false);
    void syncCloud(value).catch(() => undefined);
  }, [key, kind, syncCloud]);

  return (
    <Context.Provider
      value={{
        workspace: loaded?.key === key ? loaded.value : emptyWorkspace(),
        ready: loaded?.key === key,
        storageError,
        syncStatus,
        cloudEnabled: kind === "supabase",
        change,
        snapshot,
        clear,
        resolveConflict,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkspaceProvider is required.");
  return value;
}
