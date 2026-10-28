"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PROVIDER_ID,
  defaultProvider,
  getProvider,
  type ModelInfo,
} from "@/lib/providers/catalog";
import {
  HEADER_TOKEN,
  sanitizeSelection,
  selectionToHeaders,
  type WireSelection,
} from "@/lib/providers/selection";
import { translate, type Language, type TranslationKey, type Translator } from "./i18n";
import { clientContextFor, type PersonaId } from "./personas";

const STORAGE_KEY = "tflash:settings:v1";
const MAX_CHATS = 100;

export type Theme = "system" | "light" | "dark";

export type ConnectionRecord = {
  readonly token?: string;
  readonly label: string;
  readonly connectedAt: number;
  readonly baseURL?: string;
  readonly modelCount?: number;
  readonly source: "browser" | "server" | "keyless";
};

export type ChatRecord = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
};

export type AppSettings = {
  readonly theme: Theme;
  readonly language: Language;
  readonly persona: PersonaId;
  readonly providerId: string;
  readonly modelId: string;
  readonly contextWindow: number;
  readonly connections: Readonly<Record<string, ConnectionRecord>>;
  readonly chats: readonly ChatRecord[];
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "en",
  persona: "general",
  providerId: DEFAULT_PROVIDER_ID,
  modelId: defaultProvider().defaultModel,
  contextWindow: defaultProvider().contextWindow,
  connections: {},
  chats: [],
};

export type ModelsState = {
  readonly loading: boolean;
  readonly source: "live" | "static";
  readonly error?: string;
};

type SettingsContextValue = {
  readonly settings: AppSettings;
  readonly hydrated: boolean;
  readonly t: Translator;
  readonly selection: WireSelection;
  readonly eveHeaders: () => Record<string, string>;
  readonly turnContext: () => string;
  readonly update: (patch: Partial<AppSettings>) => void;
  readonly setModel: (providerId: string, modelId: string, contextWindow?: number) => void;
  readonly connect: (providerId: string, connection: ConnectionRecord) => void;
  readonly disconnect: (providerId: string) => void;
  readonly isConnected: (providerId: string) => boolean;
  readonly modelsFor: (providerId: string) => readonly ModelInfo[];
  readonly modelsStateFor: (providerId: string) => ModelsState;
  readonly loadModels: (providerId: string, force?: boolean) => Promise<void>;
  readonly envConfigured: Readonly<Record<string, boolean>>;
  readonly refreshStatus: () => Promise<void>;
  readonly addChat: (id: string, title: string) => Promise<void>;
  readonly removeChat: (id: string) => Promise<void>;
  readonly refreshChats: () => Promise<void>;
  readonly historyError?: string;
  readonly clearConnections: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStoredSettings(storageKey: string): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const language = window.localStorage.getItem("tflash:language") === "so" ? "so" : "en";
    if (!raw) return { ...DEFAULT_SETTINGS, language };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const provider = getProvider(parsed.providerId) ?? defaultProvider();
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      providerId: provider.id,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : provider.defaultModel,
      contextWindow:
        typeof parsed.contextWindow === "number" ? parsed.contextWindow : provider.contextWindow,
      connections:
        parsed.connections && typeof parsed.connections === "object" ? parsed.connections : {},
      // Titles and session IDs come from the authenticated Supabase account,
      // not shared browser storage.
      chats: [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function AppSettingsProvider({ children, userId }: { readonly children: ReactNode; readonly userId: string }) {
  const storageKey = `${STORAGE_KEY}:${userId}`;
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [envConfigured, setEnvConfigured] = useState<Readonly<Record<string, boolean>>>({});
  const [liveModels, setLiveModels] = useState<Readonly<Record<string, readonly ModelInfo[]>>>({});
  const [modelsState, setModelsState] = useState<Readonly<Record<string, ModelsState>>>({});
  const [historyError, setHistoryError] = useState<string>();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setSettings(readStoredSettings(storageKey));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      // Keep encrypted provider credentials scoped to this account. Chat
      // titles are retrieved from Supabase rather than persisted locally.
      window.localStorage.setItem(storageKey, JSON.stringify({ ...settings, chats: [] }));
      window.localStorage.setItem("tflash:theme", settings.theme);
      window.localStorage.setItem("tflash:language", settings.language);
    } catch {
      // Storage may be unavailable (private mode); settings stay in memory.
    }
  }, [settings, hydrated, storageKey]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = settings.theme;
    }
    root.style.colorScheme = settings.theme;
  }, [settings.theme]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const setModel = useCallback(
    (providerId: string, modelId: string, contextWindow?: number) => {
      const provider = getProvider(providerId) ?? defaultProvider();
      setSettings((current) => ({
        ...current,
        providerId: provider.id,
        modelId,
        contextWindow: contextWindow ?? provider.contextWindow,
      }));
    },
    [],
  );

  const connect = useCallback((providerId: string, connection: ConnectionRecord) => {
    setSettings((current) => ({
      ...current,
      connections: { ...current.connections, [providerId]: connection },
    }));
  }, []);

  const disconnect = useCallback((providerId: string) => {
    setSettings((current) => {
      const connections = { ...current.connections };
      delete connections[providerId];
      return { ...current, connections };
    });
  }, []);

  const isConnected = useCallback(
    (providerId: string) => Boolean(settings.connections[providerId]) || envConfigured[providerId] === true,
    [settings.connections, envConfigured],
  );

  const refreshChats = useCallback(async () => {
    try {
      const response = await fetch("/api/chats", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load conversations.");
      const data = (await response.json()) as { chats: ChatRecord[] };
      setSettings((current) => ({ ...current, chats: (data.chats ?? []).slice(0, MAX_CHATS) }));
      setHistoryError(undefined);
    } catch {
      setHistoryError("Could not load conversations. Please try again.");
    }
  }, []);

  useEffect(() => {
    if (hydrated) void refreshChats();
  }, [hydrated, refreshChats]);

  const addChat = useCallback(async (id: string, title: string) => {
    const safeTitle = title.trim().slice(0, 120) || "New conversation";
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: safeTitle }),
      });
      if (!response.ok) throw new Error("Could not save conversation.");
      setSettings((current) => ({
        ...current,
        chats: [{ id, title: safeTitle, updatedAt: Date.now() }, ...current.chats.filter((chat) => chat.id !== id)].slice(0, MAX_CHATS),
      }));
      setHistoryError(undefined);
    } catch {
      setHistoryError("Could not save the conversation. Please try again.");
      throw new Error("Could not save the conversation. Please try again.");
    }
  }, []);

  const removeChat = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
      });
      if (!response.ok) throw new Error("Could not remove conversation.");
      setSettings((current) => ({ ...current, chats: current.chats.filter((chat) => chat.id !== id) }));
      setHistoryError(undefined);
    } catch {
      setHistoryError("Could not remove the conversation. Please try again.");
      throw new Error("Could not remove the conversation. Please try again.");
    }
  }, []);

  const clearConnections = useCallback(() => update({ connections: {} }), [update]);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/providers", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        providers?: { id: string; envConfigured: boolean }[];
      };
      const next: Record<string, boolean> = {};
      for (const provider of payload.providers ?? []) next[provider.id] = provider.envConfigured;
      setEnvConfigured(next);
    } catch {
      // Offline: static catalog still works.
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadModels = useCallback(
    async (providerId: string, force = false) => {
      const provider = getProvider(providerId);
      if (!provider) return;
      if (!force && (liveModels[providerId] || modelsState[providerId]?.loading)) return;
      const token = settingsRef.current.connections[providerId]?.token;
      setModelsState((current) => ({
        ...current,
        [providerId]: { loading: true, source: "static" },
      }));
      try {
        const response = await fetch(
          `/api/providers/models?provider=${encodeURIComponent(providerId)}`,
          {
            cache: "no-store",
            headers: token ? { [HEADER_TOKEN]: token } : {},
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as {
          models?: ModelInfo[];
          source?: "live" | "static";
          error?: string;
        };
        setLiveModels((current) => ({ ...current, [providerId]: payload.models ?? [] }));
        setModelsState((current) => ({
          ...current,
          [providerId]: {
            loading: false,
            source: payload.source ?? "static",
            ...(payload.error ? { error: payload.error } : {}),
          },
        }));
      } catch (error) {
        setModelsState((current) => ({
          ...current,
          [providerId]: {
            loading: false,
            source: "static",
            error: error instanceof Error ? error.message : "Could not load models.",
          },
        }));
      }
    },
    [liveModels, modelsState],
  );

  const modelsFor = useCallback(
    (providerId: string): readonly ModelInfo[] =>
      liveModels[providerId] ?? getProvider(providerId)?.models ?? [],
    [liveModels],
  );

  const modelsStateFor = useCallback(
    (providerId: string): ModelsState =>
      modelsState[providerId] ?? { loading: false, source: "static" },
    [modelsState],
  );

  const selection = useMemo<WireSelection>(
    () =>
      sanitizeSelection({
        providerId: settings.providerId,
        modelId: settings.modelId,
        contextWindow: settings.contextWindow,
        token: settings.connections[settings.providerId]?.token,
      }),
    [settings.providerId, settings.modelId, settings.contextWindow, settings.connections],
  );

  /** Stable function: the eve client re-resolves it before every request. */
  const eveHeaders = useCallback((): Record<string, string> => {
    const current = settingsRef.current;
    return selectionToHeaders(
      sanitizeSelection({
        providerId: current.providerId,
        modelId: current.modelId,
        contextWindow: current.contextWindow,
        token: current.connections[current.providerId]?.token,
      }),
    );
  }, []);

  const turnContext = useCallback(
    () => clientContextFor(settingsRef.current.persona, settingsRef.current.language),
    [],
  );

  const t = useCallback<Translator>(
    (key: TranslationKey) => translate(settingsRef.current.language, key),
    [],
  );

  const value: SettingsContextValue = {
    settings,
    hydrated,
    t,
    selection,
    eveHeaders,
    turnContext,
    update,
    setModel,
    connect,
    disconnect,
    isConnected,
    modelsFor,
    modelsStateFor,
    loadModels,
    envConfigured,
    refreshStatus,
    addChat,
    removeChat,
    refreshChats,
    historyError,
    clearConnections,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return context;
}

