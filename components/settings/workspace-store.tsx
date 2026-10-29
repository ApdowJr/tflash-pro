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

type WorkspaceStore = {
  workspace: Workspace;
  ready: boolean;
  storageError: boolean;
  syncStatus: "local" | "syncing" | "synced" | "error";
  cloudEnabled: boolean;
  change: (fn: (current: Workspace) => Workspace) => void;
  snapshot: () => Workspace;
  clear: () => void;
};
const Context = createContext<WorkspaceStore | null>(null);

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
  const [syncStatus, setSyncStatus] = useState<"local" | "syncing" | "synced" | "error">(kind === "supabase" ? "syncing" : "local");
  const reference = useRef(loaded);
  const changeRevision = useRef(0);
  const syncSequence = useRef(0);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  reference.current = loaded;
  const syncCloud = useCallback((value: Workspace) => {
    if (kind !== "supabase") return Promise.resolve();
    const sequence = ++syncSequence.current;
    setSyncStatus("syncing");
    const task = cloudQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch("/api/workspace", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(value), cache: "no-store",
      });
      if (!response.ok) throw new Error("Workspace cloud sync failed.");
      if (sequence === syncSequence.current) setSyncStatus("synced");
    });
    cloudQueue.current = task;
    return task.catch((error: unknown) => {
      if (sequence === syncSequence.current) setSyncStatus("error");
      throw error;
    });
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let localValue = emptyWorkspace();
      let localUsable = true;
      try {
        const raw = window.localStorage.getItem(key);
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
      if (kind !== "supabase") { setSyncStatus("local"); return; }
      const revisionAtStart = changeRevision.current;
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok) throw new Error("Workspace cloud sync unavailable.");
        const result = await response.json() as { workspace?: unknown; storage?: string };
        if (cancelled) return;
        if (changeRevision.current !== revisionAtStart) {
          await syncCloud(reference.current?.key === key ? reference.current.value : localValue);
          return;
        }
        if (result.storage !== "cloud") { setSyncStatus("local"); return; }
        if (result.workspace !== null && result.workspace !== undefined) {
          const remote = workspaceSchema.parse(result.workspace);
          window.localStorage.setItem(key, JSON.stringify(remote));
          reference.current = { key, value: remote };
          setLoaded({ key, value: remote });
          setStorageError(false);
          setSyncStatus("synced");
        } else if (localUsable) {
          await syncCloud(localValue);
        } else {
          setSyncStatus("error");
        }
      } catch {
        if (!cancelled) setSyncStatus("error");
      }
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        // The localStorage event is the newest same-browser snapshot. Do not
        // race it with a cloud read that may still return the previous write.
        changeRevision.current += 1;
        try {
          const value = event.newValue === null
            ? emptyWorkspace()
            : workspaceSchema.parse(JSON.parse(event.newValue));
          reference.current = { key, value };
          setLoaded({ key, value });
          setStorageError(false);
          void syncCloud(value).catch(() => undefined);
        } catch {
          setStorageError(true);
          setSyncStatus("error");
        }
      } else if (event.key === null) {
        void load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; window.removeEventListener("storage", onStorage); };
  }, [key, kind, syncCloud]);
  const snapshot = useCallback(
    () =>
      reference.current?.key === key
        ? reference.current.value
        : emptyWorkspace(),
    [key],
  );
  const change = useCallback(
    (fn: (current: Workspace) => Workspace) => {
      if (reference.current?.key !== key)
        throw new Error("Workspace not loaded.");
      // Merge against the most recent disk value, not a stale tab snapshot.
      // Invalid data is never silently replaced by a normal edit.
      const raw = window.localStorage.getItem(key);
      const current = raw
        ? workspaceSchema.parse(JSON.parse(raw))
        : emptyWorkspace();
      const value = workspaceSchema.parse(fn(current));
      // Keep a local recovery copy, then queue the account-scoped cloud write.
      window.localStorage.setItem(key, JSON.stringify(value));
      changeRevision.current += 1;
      reference.current = { key, value };
      setLoaded({ key, value });
      setStorageError(false);
      void syncCloud(value).catch(() => undefined);
    },
    [key, syncCloud],
  );
  const clear = useCallback(() => {
    if (reference.current?.key !== key)
      throw new Error("Workspace not loaded.");
    window.localStorage.removeItem(key);
    changeRevision.current += 1;
    reference.current = { key, value: emptyWorkspace() };
    setLoaded(reference.current);
    setStorageError(false);
    void syncCloud(emptyWorkspace()).catch(() => undefined);
  }, [key, syncCloud]);
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
