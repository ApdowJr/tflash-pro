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
import { syncFetchJson } from "@/lib/sync-fetch";
import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";
import {
  emptyWorkspace,
  workspaceSchema,
  workspaceStorageKey,
  type Workspace,
} from "@/lib/workspace";

type WorkspaceSyncStatus = "local" | "syncing" | "synced" | "conflict" | "uncertain" | "error";
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
  retrySync: () => void;
};
const Context = createContext<WorkspaceStore | null>(null);
const EXPECTED_USER_HEADER = "x-tflash-expected-user-id";
const EXPECTED_KIND_HEADER = "x-tflash-expected-account-kind";

function parseCloudSnapshot(input: unknown): CloudSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid workspace response.");
  }
  const result = input as Record<string, unknown>;
  if (result.storage === "browser") return { storage: "browser", workspace: null, updatedAt: null };
  if (result.storage !== "cloud") throw new Error("Invalid workspace storage.");
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

/** Supabase uses RLS; optional Vercel sync is authorized by the server. */
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
  const supportsCloud = kind === "supabase" || kind === "vercel";
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>(supportsCloud ? "syncing" : "local");
  const [cloudEnabled, setCloudEnabled] = useState(supportsCloud);
  const [retryVersion, setRetryVersion] = useState(0);
  const cloudMode = useRef<"unknown" | "browser" | "cloud">("unknown");
  const reference = useRef(loaded);
  const activeKey = useRef(key);
  const changeRevision = useRef(0);
  const syncSequence = useRef(0);
  const cloudRevision = useRef<string | null>(null);
  const conflictKey = useRef<string | null>(null);
  // A failed/timed-out write may have committed. Do not issue a queued write
  // until the user explicitly reloads and reviews the cloud copy.
  const uncertainKey = useRef<string | null>(null);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  reference.current = loaded;
  activeKey.current = key;

  const syncCloud = useCallback((value: Workspace) => {
    if (cloudMode.current !== "cloud") return Promise.resolve();
    const targetKey = key;
    const expectedUserId = userId;
    const sequence = ++syncSequence.current;
    if (activeKey.current === targetKey) setSyncStatus("syncing");
    const task = cloudQueue.current.catch(() => undefined).then(async () => {
      if (activeKey.current !== targetKey || sequence !== syncSequence.current) return;
      if (conflictKey.current === targetKey || uncertainKey.current === targetKey) {
        setSyncStatus(uncertainKey.current === targetKey ? (conflictKey.current === targetKey ? "uncertain" : "error") : "conflict");
        return;
      }
      if (syncUncertaintyMarkers("workspace", kind, expectedUserId).length) {
        uncertainKey.current = targetKey;
        setSyncStatus("error");
        return;
      }
      // Record before dispatch, so reload cannot silently replay an unknown write.
      const marker = beginSyncUncertainty("workspace", kind, expectedUserId);
      const { response, data } = await syncFetchJson("/api/workspace", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [EXPECTED_USER_HEADER]: expectedUserId,
          [EXPECTED_KIND_HEADER]: kind,
        },
        body: JSON.stringify({ workspace: value, expectedUpdatedAt: cloudRevision.current }),
        cache: "no-store",
      });
      if (response.status === 409) {
        clearSyncUncertainty([marker]);
        if (activeKey.current !== targetKey) return;
        conflictKey.current = targetKey;
        setSyncStatus("conflict");
        return;
      }
      if (!response.ok) throw new Error("Workspace cloud sync failed.");
      const updatedAt = parseWriteRevision(data);
      clearSyncUncertainty([marker]);
      if (activeKey.current !== targetKey) return;
      cloudRevision.current = updatedAt;
      if (sequence === syncSequence.current) setSyncStatus("synced");
    });
    cloudQueue.current = task;
    return task.catch((error: unknown) => {
      if (activeKey.current === targetKey) {
        uncertainKey.current = targetKey;
        setSyncStatus("error");
      }
      throw error;
    });
  }, [key, kind, userId]);

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
    if (cloudMode.current !== "cloud" || conflictKey.current !== key) return;
    const targetKey = key;
    const changeAtStart = changeRevision.current;
    const expectedUserId = userId;
    syncSequence.current += 1;
    setSyncStatus("syncing");
    try {
      // Do not clear markers created by a different operation during review.
      const reviewedMarkers = syncUncertaintyMarkers("workspace", kind, expectedUserId);
      const { response, data } = await syncFetchJson("/api/workspace", {
        cache: "no-store",
        headers: { [EXPECTED_USER_HEADER]: expectedUserId, [EXPECTED_KIND_HEADER]: kind },
      });
      if (activeKey.current !== targetKey) return;
      if (!response.ok) throw new Error("Workspace cloud sync unavailable.");
      const remote = parseCloudSnapshot(data);
      if (activeKey.current !== targetKey) return;
      if (remote.storage !== "cloud" || changeAtStart !== changeRevision.current) throw new Error("Workspace changed during review.");
      cloudRevision.current = remote.updatedAt;
      if (choice === "cloud") {
        const value = remote.workspace ?? emptyWorkspace();
        window.localStorage.setItem(key, JSON.stringify(value));
        // Only a deliberate, successfully saved choice releases breadcrumbs.
        clearSyncUncertainty(reviewedMarkers);
        const remaining = syncUncertaintyMarkers("workspace", kind, expectedUserId).length > 0;
        uncertainKey.current = remaining ? key : null;
        reference.current = { key, value };
        setLoaded({ key, value });
        setStorageError(false);
        conflictKey.current = remaining ? key : null;
        setSyncStatus(remaining ? "uncertain" : "synced");
        return;
      }
      const local = reference.current?.key === key ? reference.current.value : emptyWorkspace();
      clearSyncUncertainty(reviewedMarkers);
      uncertainKey.current = null;
      conflictKey.current = null;
      await syncCloud(local);
    } catch {
      if (activeKey.current === targetKey) {
        conflictKey.current = targetKey;
        setSyncStatus(uncertainKey.current === targetKey ? "uncertain" : "conflict");
      }
    }
  }, [key, kind, syncCloud, userId]);

  useEffect(() => {
    let cancelled = false;
    let loadSequence = 0;
    cloudRevision.current = null;
    conflictKey.current = null;
    // Preserve uncertainty across an explicit retry for this account.
    if (uncertainKey.current !== key) uncertainKey.current = null;
    cloudMode.current = "unknown";
    setCloudEnabled(supportsCloud);
    setSyncStatus(supportsCloud ? "syncing" : "local");
    const load = async () => {
      const request = ++loadSequence;
      let localValue = emptyWorkspace();
      let localUsable = true;
      let localExists = false;
      try {
        const raw = window.localStorage.getItem(key);
        localExists = raw !== null;
        localValue = raw !== null ? workspaceSchema.parse(JSON.parse(raw)) : emptyWorkspace();
        reference.current = { key, value: localValue };
        setLoaded({ key, value: localValue });
        setStorageError(false);
      } catch {
        // Preserve corrupt or inaccessible data; never replace it automatically.
        localUsable = false;
        reference.current = { key, value: emptyWorkspace() };
        setLoaded(reference.current);
        setStorageError(true);
      }
      if (!supportsCloud) return;
      const revisionAtStart = changeRevision.current;
      try {
        const { response, data } = await syncFetchJson("/api/workspace", {
          cache: "no-store",
          headers: { [EXPECTED_USER_HEADER]: userId, [EXPECTED_KIND_HEADER]: kind },
        });
        if (!response.ok) throw new Error("Workspace cloud sync unavailable.");
        const result = parseCloudSnapshot(data);
        if (cancelled || request !== loadSequence || activeKey.current !== key) return;
        if (result.storage === "browser") { cloudMode.current = "browser"; setCloudEnabled(false); setSyncStatus("local"); return; }
        cloudMode.current = "cloud";
        setCloudEnabled(true);
        cloudRevision.current = result.updatedAt;
        const current = reference.current?.key === key ? reference.current.value : localValue;
        // Never overwrite malformed or inaccessible browser data automatically.
        if (!localUsable) { setSyncStatus("error"); return; }
        if (uncertainKey.current === key || syncUncertaintyMarkers("workspace", kind, userId).length) {
          uncertainKey.current = key;
          // A matching read can show the desired copy, but an older timed-out
          // request may still be running. Require explicit review in all cases.
          conflictKey.current = key;
          setSyncStatus("uncertain");
          return;
        }
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
          if (!localExists) window.localStorage.setItem(key, JSON.stringify(result.workspace));
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
        if (!cancelled && request === loadSequence && activeKey.current === key) setSyncStatus("error");
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
            setSyncStatus(uncertainKey.current === key ? "uncertain" : "conflict");
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
  }, [key, kind, supportsCloud, syncCloud, userId, retryVersion]);

  const snapshot = useCallback(
    () => reference.current?.key === key ? reference.current.value : emptyWorkspace(),
    [key],
  );
  const change = useCallback((fn: (current: Workspace) => Workspace) => {
    if (reference.current?.key !== key) throw new Error("Workspace not loaded.");
    // Merge against the most recent disk value, not a stale tab snapshot.
    // Invalid data is never silently replaced by a normal edit.
    const raw = window.localStorage.getItem(key);
    const current = raw !== null ? workspaceSchema.parse(JSON.parse(raw)) : emptyWorkspace();
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
    if (kind === "supabase" || (kind === "vercel" && cloudMode.current !== "browser")) window.localStorage.setItem(key, JSON.stringify(value));
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
        cloudEnabled,
        change,
        snapshot,
        clear,
        resolveConflict,
        retrySync: () => setRetryVersion((version) => version + 1),
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
