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
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
import { HEADER_INTEGRATION_TOKENS } from "@/lib/integrations/wire";
import {
  HEADER_TOKEN,
  sanitizeSelection,
  selectionToHeaders,
  type WireSelection,
} from "@/lib/providers/selection";
import { translate, type Language, type TranslationKey, type Translator } from "./i18n";
import { clientContextFor, type PersonaId } from "./personas";

export const STORAGE_KEY = "tflash:settings:v1";
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

/** Sealed (opaque) integration token kept in this browser. */
export type IntegrationTokenRecord = {
  readonly token: string;
  readonly label: string;
  readonly connectedAt: number;
  /** Envelope expiry (how long this browser keeps the sealed record). */
  readonly expiresAt?: number;
  /** When the provider's own access token lapses; renewed ahead of time. */
  readonly tokenExpiresAt?: number;
  /** True when the provider supports silent renewal. */
  readonly refreshable?: boolean;
  /** How the record was created, for honest UI copy. */
  readonly source?: "oauth" | "token";
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
  readonly integrationTokens: Readonly<Record<string, IntegrationTokenRecord>>;
  readonly chats: readonly ChatRecord[];
  readonly chatProofs: Readonly<Record<string, string>>;
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "en",
  persona: "general",
  providerId: DEFAULT_PROVIDER_ID,
  modelId: defaultProvider().defaultModel,
  contextWindow: defaultProvider().contextWindow,
  connections: {},
  integrationTokens: {},
  chats: [],
  chatProofs: {},
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
  readonly connectIntegration: (integrationId: string, record: IntegrationTokenRecord) => void;
  readonly disconnectIntegration: (integrationId: string) => void;
  readonly disconnect: (providerId: string) => void;
  readonly isConnected: (providerId: string) => boolean;
  readonly modelsFor: (providerId: string) => readonly ModelInfo[];
  readonly modelsStateFor: (providerId: string) => ModelsState;
  readonly loadModels: (providerId: string, force?: boolean) => Promise<void>;
  readonly envConfigured: Readonly<Record<string, boolean>>;
  /** Set when an OAuth round trip came back with a problem, for the panel to show. */
  readonly oauthError?: string;
  /** The integration whose authorization just completed, for a one-line confirmation. */
  readonly oauthJustConnected?: string;
  readonly clearOAuthNotice: () => void;
  readonly refreshStatus: () => Promise<void>;
  readonly addChat: (id: string, title: string) => Promise<void>;
  readonly removeChat: (id: string) => Promise<void>;
  readonly refreshChats: () => Promise<void>;
  readonly registerChatProof: (id: string, proof: string) => void;
  readonly historyError?: string;
  readonly clearConnections: () => void;
  /** Remove locally stored provider and integration credentials on sign-out. */
  readonly clearLocalCredentials: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStoredSettings(storageKey: string, accountKind: "supabase" | "vercel"): AppSettings {
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
      integrationTokens:
        parsed.integrationTokens && typeof parsed.integrationTokens === "object" ? parsed.integrationTokens : {},
      chats: accountKind === "vercel" && Array.isArray(parsed.chats) ? parsed.chats.slice(0, MAX_CHATS) : [],
      chatProofs: accountKind === "vercel" && parsed.chatProofs && typeof parsed.chatProofs === "object" ? parsed.chatProofs : {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function AppSettingsProvider({ children, userId, accountKind }: { readonly children: ReactNode; readonly userId: string; readonly accountKind: "supabase" | "vercel" }) {
  const storageKey = `${STORAGE_KEY}:${userId}`;
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [envConfigured, setEnvConfigured] = useState<Readonly<Record<string, boolean>>>({});
  const [liveModels, setLiveModels] = useState<Readonly<Record<string, readonly ModelInfo[]>>>({});
  const [modelsState, setModelsState] = useState<Readonly<Record<string, ModelsState>>>({});
  const [historyError, setHistoryError] = useState<string>();
  const [oauthError, setOauthError] = useState<string>();
  const [oauthJustConnected, setOauthJustConnected] = useState<string>();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setSettings(readStoredSettings(storageKey, accountKind));
    setHydrated(true);
  }, [storageKey, accountKind]);

  /**
   * Finish an OAuth round trip: the callback wrote a short-lived HttpOnly
   * cookie, this reads it once, stores the sealed record, and cleans the URL.
   */
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("oauth");
    const integrationId = url.searchParams.get("integration");
    const connected = url.searchParams.get("connected");
    if (!code && !integrationId && !connected) return;

    let cancelled = false;
    void (async () => {
      if (connected === "1") {
        try {
          const response = await fetch("/api/integrations/oauth/result", { cache: "no-store" });
          const payload = (await response.json()) as {
            connected?: boolean;
            integrationId?: string;
            token?: string;
            expiresAt?: number;
            tokenExpiresAt?: number;
            refreshable?: boolean;
            label?: string;
          };
          if (!cancelled && payload.connected && payload.integrationId && payload.token) {
            setSettings((current) => ({
              ...current,
              integrationTokens: {
                ...current.integrationTokens,
                [payload.integrationId as string]: {
                  token: payload.token as string,
                  label: payload.label ?? "Authorized",
                  connectedAt: Date.now(),
                  ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
                  ...(payload.tokenExpiresAt ? { tokenExpiresAt: payload.tokenExpiresAt } : {}),
                  refreshable: payload.refreshable === true,
                  source: "oauth" as const,
                },
              },
            }));
            setOauthJustConnected(payload.integrationId);
          }
        } catch {
          if (!cancelled) setOauthError("error");
        }
      }
      if (!cancelled && code) setOauthError(code);

      for (const key of ["oauth", "integration", "connected"]) url.searchParams.delete(key);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const clearOAuthNotice = useCallback(() => {
    setOauthError(undefined);
    setOauthJustConnected(undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      // Keep encrypted provider credentials scoped to this account. Chat
      // titles are retrieved from Supabase rather than persisted locally.
      window.localStorage.setItem(storageKey, JSON.stringify({ ...settings, chats: accountKind === "vercel" ? settings.chats : [], chatProofs: accountKind === "vercel" ? settings.chatProofs : {} }));
      window.localStorage.setItem("tflash:theme", settings.theme);
      window.localStorage.setItem("tflash:language", settings.language);
    } catch {
      // Storage may be unavailable (private mode); settings stay in memory.
    }
  }, [settings, hydrated, storageKey, accountKind]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") {
      root.removeAttribute("data-theme");
      root.style.removeProperty("color-scheme");
    } else {
      root.dataset.theme = settings.theme;
      root.style.colorScheme = settings.theme;
    }
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

  const connectIntegration = useCallback(
    (integrationId: string, record: IntegrationTokenRecord) => {
      setSettings((current) => ({
        ...current,
        integrationTokens: { ...current.integrationTokens, [integrationId]: record },
      }));
    },
    [],
  );

  const disconnectIntegration = useCallback((integrationId: string) => {
    setSettings((current) => {
      const integrationTokens = { ...current.integrationTokens };
      delete integrationTokens[integrationId];
      return { ...current, integrationTokens };
    });
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

  const registerChatProof = useCallback((id: string, proof: string) => {
    if (accountKind !== "vercel") return;
    setSettings((current) => current.chatProofs[id] === proof ? current : ({ ...current, chatProofs: { ...current.chatProofs, [id]: proof } }));
  }, [accountKind]);

  const refreshChats = useCallback(async () => {
    if (accountKind === "vercel") return;
    try {
      const response = await fetch("/api/chats", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load conversations.");
      const data = (await response.json()) as { chats: ChatRecord[] };
      setSettings((current) => ({ ...current, chats: (data.chats ?? []).slice(0, MAX_CHATS) }));
      setHistoryError(undefined);
    } catch {
      setHistoryError("Could not load conversations. Please try again.");
    }
  }, [accountKind]);

  useEffect(() => {
    if (hydrated) void refreshChats();
  }, [hydrated, refreshChats]);

  const addChat = useCallback(async (id: string, title: string) => {
    const safeTitle = title.trim().slice(0, 120) || "New conversation";
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(accountKind === "vercel" ? { [OWNER_PROOF_HEADER]: settingsRef.current.chatProofs[id] ?? "" } : {}) },
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
  }, [accountKind]);

  const removeChat = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { "content-type": "application/json", ...(accountKind === "vercel" ? { [OWNER_PROOF_HEADER]: settingsRef.current.chatProofs[id] ?? "" } : {}) },
      });
      if (!response.ok) throw new Error("Could not remove conversation.");
      setSettings((current) => {
        const chatProofs = { ...current.chatProofs };
        delete chatProofs[id];
        return { ...current, chatProofs, chats: current.chats.filter((chat) => chat.id !== id) };
      });
      setHistoryError(undefined);
    } catch {
      setHistoryError("Could not remove the conversation. Please try again.");
      throw new Error("Could not remove the conversation. Please try again.");
    }
  }, [accountKind]);

  const clearConnections = useCallback(() => update({ connections: {} }), [update]);

  const clearLocalCredentials = useCallback(() => {
    const cleared = { ...settingsRef.current, connections: {}, integrationTokens: {} };
    settingsRef.current = cleared;
    // Persist synchronously before navigating, while preserving the Vercel
    // browser-only history and proofs needed to resume those conversations.
    try { window.localStorage.setItem(storageKey, JSON.stringify(cleared)); } catch { /* storage unavailable */ }
    setSettings(cleared);
  }, [storageKey]);

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
    const headers = selectionToHeaders(
      sanitizeSelection({
        providerId: current.providerId,
        modelId: current.modelId,
        contextWindow: current.contextWindow,
        token: current.connections[current.providerId]?.token,
      }),
    );
    const now = Date.now();
    const sealed = Object.values(current.integrationTokens)
      .filter((record) => !record.expiresAt || record.expiresAt > now)
      .filter((record) => !record.tokenExpiresAt || record.tokenExpiresAt > now)
      .map((record) => record.token)
      .filter((token) => typeof token === "string" && token.startsWith("v1."));
    if (sealed.length > 0) {
      headers[HEADER_INTEGRATION_TOKENS] = JSON.stringify(sealed);
    }
    return headers;
  }, []);

  const turnContext = useCallback(
    () => clientContextFor(settingsRef.current.persona, settingsRef.current.language),
    [],
  );

  const t = useCallback<Translator>(
    (key: TranslationKey) => translate(settingsRef.current.language, key),
    [],
  );

  /**
   * OAuth grants can lapse (Linear 24h, PostHog 1h). Renew them while the app
   * is open, well before the access token dies, so a tool call never lands on
   * an expired credential.
   */
  const refreshingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    const renew = async () => {
      const current = settingsRef.current.integrationTokens;
      const now = Date.now();
      for (const [integrationId, record] of Object.entries(current)) {
        if (!record.refreshable) continue;
        if (refreshingRef.current.has(integrationId)) continue;
        const due =
          typeof record.tokenExpiresAt === "number"
            ? record.tokenExpiresAt - now < 10 * 60 * 1000
            : true;
        if (!due) continue;

        refreshingRef.current.add(integrationId);
        try {
          const response = await fetch("/api/integrations/oauth/refresh", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: record.token }),
          });
          const payload = (await response.json()) as {
            ok?: boolean;
            token?: string;
            expiresAt?: number;
            tokenExpiresAt?: number;
          };
          if (cancelled) return;
          if (payload.ok && payload.token) {
            setSettings((latest) => ({
              ...latest,
              integrationTokens: {
                ...latest.integrationTokens,
                [integrationId]: {
                  ...record,
                  token: payload.token as string,
                  ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
                  ...(payload.tokenExpiresAt ? { tokenExpiresAt: payload.tokenExpiresAt } : {}),
                },
              },
            }));
          } else if (response.status === 401 || response.status === 409) {
            // The grant is gone: drop it so the UI says "not connected" instead
            // of pretending a dead token still works.
            setSettings((latest) => {
              const integrationTokens = { ...latest.integrationTokens };
              delete integrationTokens[integrationId];
              return { ...latest, integrationTokens };
            });
          }
        } catch {
          // Offline: try again on the next tick.
        } finally {
          refreshingRef.current.delete(integrationId);
        }
      }
    };

    void renew();
    const timer = window.setInterval(() => void renew(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hydrated]);

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
    connectIntegration,
    disconnectIntegration,
    disconnect,
    isConnected,
    modelsFor,
    modelsStateFor,
    loadModels,
    envConfigured,
    ...(oauthError ? { oauthError } : {}),
    ...(oauthJustConnected ? { oauthJustConnected } : {}),
    clearOAuthNotice,
    refreshStatus,
    addChat,
    removeChat,
    refreshChats,
    registerChatProof,
    historyError,
    clearConnections,
    clearLocalCredentials,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return context;
}

