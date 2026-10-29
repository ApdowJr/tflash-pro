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
  change: (fn: (current: Workspace) => Workspace) => void;
  snapshot: () => Workspace;
  clear: () => void;
};
const Context = createContext<WorkspaceStore | null>(null);

/** Deliberately browser-local for BOTH login systems, never a shared tenant store. */
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
  const reference = useRef(loaded);
  reference.current = loaded;
  useEffect(() => {
    const load = () => {
      try {
        const raw = window.localStorage.getItem(key);
        const value = raw
          ? workspaceSchema.parse(JSON.parse(raw))
          : emptyWorkspace();
        reference.current = { key, value };
        setLoaded({ key, value });
        setStorageError(false);
      } catch {
        // Do not overwrite corrupt/unavailable storage with an empty default.
        reference.current = { key, value: emptyWorkspace() };
        setLoaded(reference.current);
        setStorageError(true);
      }
    };
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
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
      // Persist BEFORE presenting success. A failed write keeps the last state.
      window.localStorage.setItem(key, JSON.stringify(value));
      reference.current = { key, value };
      setLoaded({ key, value });
      setStorageError(false);
    },
    [key],
  );
  const clear = useCallback(() => {
    if (reference.current?.key !== key)
      throw new Error("Workspace not loaded.");
    window.localStorage.removeItem(key);
    reference.current = { key, value: emptyWorkspace() };
    setLoaded(reference.current);
    setStorageError(false);
  }, [key]);
  return (
    <Context.Provider
      value={{
        workspace: loaded?.key === key ? loaded.value : emptyWorkspace(),
        ready: loaded?.key === key,
        storageError,
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
