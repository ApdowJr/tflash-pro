"use client";

import { beginHandoff, handoffLockName, handoffWarnings, type HandoffWarning } from "@/lib/oauth-handoff-recovery";
import { syncFetchJson } from "@/lib/sync-fetch";
import { fetchCatalogJson } from "@/lib/catalog-fetch";
import { beginChatAction, chatActionWarnings, clearChatAction, ChatActionUncertainError, type ChatActionWarning } from "@/lib/chat-action-recovery";
import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";
import { beginRenewal, renewalFingerprint, renewalLockName, renewalMarkers, settleRenewal, type RenewalMarker } from "@/lib/oauth-renewal-recovery";

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
import { providerConnectionExpired } from "@/lib/providers/connection-state";
import { getIntegration } from "@/lib/integrations/catalog";
import { HEADER_INTEGRATION_TOKENS } from "@/lib/integrations/wire";
import {
  HEADER_TOKEN,
  sanitizeSelection,
  selectionToHeaders,
  type WireSelection,
} from "@/lib/providers/selection";
import { translate, type Language, type TranslationKey, type Translator } from "./i18n";
import { WorkspaceProvider } from "./workspace-store";
import { clientContextFor, type PersonaId } from "./personas";

export const STORAGE_KEY = "tflash:settings:v1";
const MAX_CHATS = 100;
class ChatActionRejectedError extends Error {}

export type Theme = "system" | "light" | "dark";

export type ConnectionRecord = {
  readonly token?: string;
  readonly label: string;
  readonly connectedAt: number;
  readonly expiresAt?: number;
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
  /** Rate-limit renewal when the provider gives no access-token expiry. */
  readonly lastRenewalAt?: number;
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
  readonly accountId: string;
  readonly accountKind: "supabase" | "vercel";
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
  readonly recordChatActivity: (id: string, initialTitle: string) => Promise<void>;
  readonly renameChat: (id: string, title: string) => Promise<void>;
  readonly removeChat: (id: string) => Promise<void>;
  readonly refreshChats: () => Promise<void>;
  readonly registerChatProof: (id: string, proof: string) => void;
  readonly historyError?: "historyLoadFailed" | "historyImportUncertain";
  readonly chatActionWarnings: readonly ChatActionWarning[];
  readonly chatActionStorageError: boolean;
  readonly acknowledgeChatAction: (key: string) => void;
  readonly oauthHandoffWarnings: readonly HandoffWarning[];
  readonly oauthHandoffUnavailable: boolean;
  readonly reviewOAuthHandoff: (key: string) => Promise<boolean>;
  readonly oauthRenewalWarnings: readonly RenewalMarker[];
  readonly oauthRenewalStale: readonly string[];
  readonly oauthRenewalUnavailable: boolean;
  readonly reviewOAuthRenewal: (integrationId: string) => Promise<boolean>;
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
  const identity = `${accountKind}:${userId}`;
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydratedIdentity, setHydratedIdentity] = useState("");
  const hydrated = hydratedIdentity === identity;
  const [envSnapshot, setEnvSnapshot] = useState<{ identity: string; values: Readonly<Record<string, boolean>> }>({ identity: "", values: {} });
  const envConfigured = envSnapshot.identity === identity ? envSnapshot.values : {};
  const [liveModels, setLiveModels] = useState<Readonly<Record<string, { token?: string; identity: string; models: readonly ModelInfo[] }>>>({});
  const [modelsState, setModelsState] = useState<Readonly<Record<string, ModelsState & { token?: string; identity: string }>>>({});
  const [historyError, setHistoryError] = useState<"historyLoadFailed" | "historyImportUncertain">();
  const [actionWarnings, setActionWarnings] = useState<ChatActionWarning[]>([]);
  const [chatActionStorageError, setChatActionStorageError] = useState(false);
  const [oauthHandoffWarnings, setOAuthHandoffWarnings] = useState<HandoffWarning[]>([]);
  const [oauthHandoffUnavailable, setOAuthHandoffUnavailable] = useState(false);
  const [handoffWarningIdentity, setHandoffWarningIdentity] = useState("");
  const [oauthRenewalWarnings, setOAuthRenewalWarnings] = useState<RenewalMarker[]>([]);
  const [oauthRenewalStale, setOAuthRenewalStale] = useState<string[]>([]);
  const [oauthRenewalUnavailable, setOAuthRenewalUnavailable] = useState(false);
  const [oauthNoticeIdentity, setOAuthNoticeIdentity] = useState(identity);
  const [oauthError, setOauthError] = useState<string>();
  const [oauthJustConnected, setOauthJustConnected] = useState<string>();
  const chatOperations = useRef(new Map<string, Promise<void>>());
  const historyRevision = useRef(0);
  const historyRefreshSequence = useRef(0);
  const historyImportUncertain = useRef(false);
  const historyImportInFlight = useRef(false);
  const historyIdentity = useRef(`${accountKind}:${userId}`);
  historyIdentity.current = `${accountKind}:${userId}`;
  const modelRequests = useRef(new Map<string, { token?: string; identity: string; controller: AbortController }>());
  const providerStatusRequest = useRef<{ controller: AbortController; sequence: number }>({ controller: new AbortController(), sequence: 0 });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setSettings(readStoredSettings(storageKey, accountKind));
    setHydratedIdentity(identity);
  }, [storageKey, accountKind, identity]);

  useEffect(() => { setOauthError(undefined); setOauthJustConnected(undefined); setOAuthNoticeIdentity(identity); }, [identity]);

  const loadHandoffWarnings = useCallback(() => {
    try { setOAuthHandoffWarnings(handoffWarnings(accountKind, userId)); setOAuthHandoffUnavailable(false); setHandoffWarningIdentity(identity); }
    catch { setOAuthHandoffUnavailable(true); setHandoffWarningIdentity(identity); }
  }, [accountKind, userId, identity]);

  useEffect(() => {
    if (!hydrated) return;
    loadHandoffWarnings();
    const onStorage = () => loadHandoffWarnings();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [hydrated, loadHandoffWarnings]);

  const reviewOAuthHandoff = useCallback(async (key: string) => {
    try {
      const locks = navigator.locks;
      if (!locks?.request) return false;
      return await locks.request(handoffLockName(), { ifAvailable: true }, async (lock) => {
        if (!lock || historyIdentity.current !== identity || !handoffWarnings(accountKind, userId).some((item) => item.key === key)) return false;
        clearSyncUncertainty([key]);
        loadHandoffWarnings();
        return true;
      });
    } catch { setOAuthHandoffUnavailable(true); return false; }
  }, [accountKind, userId, identity, loadHandoffWarnings]);

  /** A one-shot cookie response may be lost. Never automatically consume it again
   * after dispatch without explicit review, including after a page reload. */
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("oauth");
    const integrationId = url.searchParams.get("integration");
    const connected = url.searchParams.get("connected");
    if (!code && !integrationId && !connected) return;
    let cancelled = false;
    const controller = new AbortController();
    const active = () => !cancelled && !controller.signal.aborted && historyIdentity.current === identity;
    const cleanUrl = () => {
      if (!active()) return;
      const latest = new URL(window.location.href);
      // Do not erase a newer OAuth redirect's parameters.
      if (latest.searchParams.get("integration") !== integrationId || latest.searchParams.get("connected") !== connected || latest.searchParams.get("oauth") !== code) return;
      for (const key of ["oauth", "integration", "connected"]) latest.searchParams.delete(key);
      window.history.replaceState({}, "", `${latest.pathname}${latest.search}${latest.hash}`);
    };
    void Promise.resolve().then(async () => {
      if (!active()) return;
      if (connected === "1") {
        try {
          if (!integrationId || !getIntegration(integrationId) || !navigator.locks?.request) throw new Error("Handoff coordination unavailable.");
          await navigator.locks.request(handoffLockName(), { ifAvailable: true }, async (lock) => {
            if (!active()) return;
            if (!lock) throw new Error("Handoff already in progress.");
            if (handoffWarnings(accountKind, userId).length) { loadHandoffWarnings(); return; }
            const baseline = settingsRef.current.integrationTokens[integrationId]?.token;
            const raw = window.localStorage.getItem(storageKey);
            const disk = raw ? JSON.parse(raw) as AppSettings : settingsRef.current;
            if (disk.integrationTokens?.[integrationId]?.token !== baseline) throw new Error("Connection changed.");
            const marker = beginHandoff(accountKind, userId, integrationId);
            loadHandoffWarnings();
            try {
              const { response, data } = await fetchCatalogJson("/api/integrations/oauth/result", { cache: "no-store", signal: controller.signal,
                headers: { "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind } }, 12_000, 64 * 1024);
              const payload = data as { connected?: unknown; integrationId?: unknown; token?: unknown; expiresAt?: unknown; tokenExpiresAt?: unknown; refreshable?: unknown; label?: unknown } | undefined;
              if (!response.ok || !payload || payload.connected !== true || payload.integrationId !== integrationId || typeof payload.token !== "string" ||
                  !payload.token.startsWith("v1.") || payload.token.length > 16_000 ||
                  (payload.expiresAt !== undefined && (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now())) ||
                  (payload.tokenExpiresAt !== undefined && (typeof payload.tokenExpiresAt !== "number" || !Number.isFinite(payload.tokenExpiresAt) || payload.tokenExpiresAt <= Date.now())) ||
                  (payload.refreshable !== undefined && typeof payload.refreshable !== "boolean") ||
                  (payload.label !== undefined && (typeof payload.label !== "string" || payload.label.length > 200))) throw new Error("Handoff outcome unknown.");
              if (!active()) return;
              const latestRaw = window.localStorage.getItem(storageKey);
              const latest = latestRaw ? JSON.parse(latestRaw) as AppSettings : settingsRef.current;
              if (latest.integrationTokens?.[integrationId]?.token !== baseline || settingsRef.current.integrationTokens[integrationId]?.token !== baseline) throw new Error("Connection changed.");
              const record: IntegrationTokenRecord = { token: payload.token, label: typeof payload.label === "string" ? payload.label : "Authorized", connectedAt: Date.now(),
                ...(typeof payload.expiresAt === "number" ? { expiresAt: payload.expiresAt } : {}),
                ...(typeof payload.tokenExpiresAt === "number" ? { tokenExpiresAt: payload.tokenExpiresAt } : {}), refreshable: payload.refreshable === true, source: "oauth" };
              const next = { ...latest, integrationTokens: { ...latest.integrationTokens, [integrationId]: record } };
              window.localStorage.setItem(storageKey, JSON.stringify(next));
              if (!active()) return;
              settingsRef.current = { ...settingsRef.current, integrationTokens: { ...settingsRef.current.integrationTokens, [integrationId]: record } };
              setSettings((current) => current.integrationTokens[integrationId]?.token !== baseline ? current : ({ ...current, integrationTokens: { ...current.integrationTokens, [integrationId]: record } }));
              clearSyncUncertainty([marker]);
              loadHandoffWarnings();
              setOAuthRenewalStale((ids) => ids.filter((id) => id !== integrationId));
              setOauthJustConnected(integrationId);
            } catch { if (active()) { loadHandoffWarnings(); setOauthError("handoff"); } }
          });
        } catch {
          if (active()) { setOAuthHandoffUnavailable(true); setOauthError("error"); }
        }
      }
      let keepUncertainUrl = false;
      if (active() && (code === "registration_uncertain" || code === "exchange_uncertain" || code === "exchange")) {
        try {
          if (!integrationId || !getIntegration(integrationId)) throw new Error("Recovery unavailable.");
          // Recording this warning has no provider side effect. Give each
          // redirect its own marker, even if a different flow is in progress.
          beginHandoff(accountKind, userId, integrationId);
          loadHandoffWarnings();
          if (!navigator.locks?.request) setOAuthHandoffUnavailable(true);
        } catch {
          // Keep the secret-free error query so reload cannot erase the only warning.
          keepUncertainUrl = true;
          if (active()) setOAuthHandoffUnavailable(true);
        }
      }
      if (active() && code) setOauthError(code);
      if (!keepUncertainUrl) cleanUrl();
    });
    return () => { cancelled = true; controller.abort(); };
  }, [hydrated, identity, accountKind, userId, storageKey, loadHandoffWarnings]);

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
    settingsRef.current = { ...settingsRef.current, connections: { ...settingsRef.current.connections, [providerId]: connection } };
    setSettings((current) => ({
      ...current,
      connections: { ...current.connections, [providerId]: connection },
    }));
  }, []);

  const connectIntegration = useCallback(
    (integrationId: string, record: IntegrationTokenRecord) => {
      settingsRef.current = { ...settingsRef.current, integrationTokens: { ...settingsRef.current.integrationTokens, [integrationId]: record } };
      setOAuthRenewalStale((ids) => ids.filter((id) => id !== integrationId));
      setSettings((current) => ({
        ...current,
        integrationTokens: { ...current.integrationTokens, [integrationId]: record },
      }));
    },
    [],
  );

  const disconnectIntegration = useCallback((integrationId: string) => {
    setOAuthRenewalStale((ids) => ids.filter((id) => id !== integrationId));
    const prior = settingsRef.current.integrationTokens[integrationId];
    const integrationTokens = { ...settingsRef.current.integrationTokens };
    delete integrationTokens[integrationId];
    settingsRef.current = { ...settingsRef.current, integrationTokens };
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const disk = JSON.parse(raw) as AppSettings;
        if (disk.integrationTokens?.[integrationId]?.token === prior?.token) {
          const diskTokens = { ...disk.integrationTokens };
          delete diskTokens[integrationId];
          window.localStorage.setItem(storageKey, JSON.stringify({ ...disk, integrationTokens: diskTokens }));
        }
      }
    } catch { /* The in-memory disconnection still takes effect. */ }
    setSettings((current) => {
      const tokens = { ...current.integrationTokens };
      delete tokens[integrationId];
      return { ...current, integrationTokens: tokens };
    });
  }, [storageKey]);

  const disconnect = useCallback((providerId: string) => {
    const immediate = { ...settingsRef.current.connections };
    delete immediate[providerId];
    settingsRef.current = { ...settingsRef.current, connections: immediate };
    setSettings((current) => {
      const connections = { ...current.connections };
      delete connections[providerId];
      return { ...current, connections };
    });
  }, []);

  const isConnected = useCallback(
    (providerId: string) => {
      const connection = settings.connections[providerId];
      // An expired browser token still takes precedence on the server, so do
      // not show an environment key as usable until the user disconnects it.
      if (providerConnectionExpired(connection)) return false;
      if (connection?.source === "server") return envConfigured[providerId] === true;
      return Boolean(connection) || envConfigured[providerId] === true;
    },
    [settings.connections, envConfigured],
  );

  const registerChatProof = useCallback((id: string, proof: string) => {
    if (accountKind !== "vercel") return;
    if (settingsRef.current.chatProofs[id] === proof) return;
    const next = { ...settingsRef.current, chatProofs: { ...settingsRef.current.chatProofs, [id]: proof } };
    // Persist the owner proof before the creation recovery marker is removed.
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    historyRevision.current += 1;
    settingsRef.current = next;
    setSettings((current) => current.chatProofs[id] === proof ? current : ({ ...current, chatProofs: { ...current.chatProofs, [id]: proof } }));
  }, [accountKind, storageKey]);

  const refreshHistory = useCallback(async (explicit: boolean) => {
    const identity = `${accountKind}:${userId}`;
    // Do not start another import while the first can still commit.
    if (historyImportInFlight.current) return;
    const revision = historyRevision.current;
    const request = ++historyRefreshSequence.current;
    const current = () => identity === historyIdentity.current && revision === historyRevision.current && request === historyRefreshSequence.current;
    let importStarted = false;
    let markers: string[] = [];
    const identityHeaders = { "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind };
    try {
      if (accountKind === "vercel") {
        markers = syncUncertaintyMarkers("history", accountKind, userId);
        if (!explicit && (historyImportUncertain.current || markers.length)) {
          if (current()) setHistoryError("historyImportUncertain");
          return;
        }
      }
      const { response, data: initial } = await syncFetchJson("/api/chats", { cache: "no-store", headers: identityHeaders });
      if (!response.ok) throw new Error("Could not load conversations.");
      let data = initial as { chats: (ChatRecord & { proof?: unknown })[]; storage?: string };
      if (!current()) return;
      if (accountKind === "vercel") {
        if (data.storage === "browser") { setHistoryError(undefined); return; }
        if (data.storage !== "account") throw new Error("Invalid history storage.");
        // Verified imports are idempotent and tombstone-safe; an uncertain
        // response requires an explicit retry, not an automatic focus retry.
        const local = settingsRef.current;
        if (local.chats.length) {
          const chats = local.chats.map((chat) => ({ ...chat, proof: local.chatProofs[chat.id] }));
          importStarted = true;
          historyImportInFlight.current = true;
          const marker = beginSyncUncertainty("history", accountKind, userId);
          markers.push(marker);
          const imported = await syncFetchJson("/api/chats/vercel-sync", {
            method: "POST", headers: { ...identityHeaders, "content-type": "application/json" }, body: JSON.stringify({ chats }), cache: "no-store",
          });
          if (!imported.response.ok) throw new Error("Could not sync conversations.");
          data = imported.data as typeof data;
        }
        if (data.storage !== "account" || !Array.isArray(data.chats) || data.chats.some((chat) =>
          typeof chat.id !== "string" || typeof chat.title !== "string" || typeof chat.updatedAt !== "number" || typeof chat.proof !== "string")) {
          throw new Error("Invalid account history.");
        }
      }
      if (!current()) return;
      if (accountKind === "vercel") clearSyncUncertainty(markers);
      historyImportUncertain.current = false;
      setSettings((currentSettings) => ({ ...currentSettings,
        chats: (data.chats ?? []).slice(0, MAX_CHATS).map(({id,title,updatedAt}) => ({id,title,updatedAt})),
        chatProofs: accountKind === "vercel" ? { ...currentSettings.chatProofs, ...Object.fromEntries(data.chats.map((chat) => [chat.id, chat.proof as string])) } : currentSettings.chatProofs,
      }));
      setHistoryError(undefined);
    } catch {
      if (identity === historyIdentity.current && importStarted) historyImportUncertain.current = true;
      if (current()) setHistoryError(importStarted ? "historyImportUncertain" : "historyLoadFailed");
    } finally {
      if (importStarted) historyImportInFlight.current = false;
    }
  }, [accountKind, userId]);
  const refreshChats = useCallback(() => refreshHistory(true), [refreshHistory]);

  useEffect(() => {
    if (hydrated) void refreshHistory(false);
    return () => { historyRefreshSequence.current += 1; };
  }, [hydrated, refreshHistory]);

  useEffect(() => {
    if (!hydrated || accountKind !== "vercel") return;
    const onFocus = () => { void refreshHistory(false); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [hydrated, accountKind, refreshHistory]);

  const loadActionWarnings = useCallback(() => {
    try {
      setActionWarnings(chatActionWarnings(accountKind, userId));
      setChatActionStorageError(false);
    } catch { setChatActionStorageError(true); }
  }, [accountKind, userId]);

  useEffect(() => {
    loadActionWarnings();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("tflash:sync-uncertain:chat-action:")) loadActionWarnings();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadActionWarnings]);

  const acknowledgeChatAction = useCallback((key: string) => {
    try {
      // Only an already displayed marker of this account can be acknowledged.
      if (!chatActionWarnings(accountKind, userId).some((warning) => warning.key === key)) return;
      clearChatAction(key);
      loadActionWarnings();
    } catch { setChatActionStorageError(true); }
  }, [accountKind, userId, loadActionWarnings]);

  const runChatMutation = useCallback(async (id: string, action: "activity" | "rename" | "remove", dispatch: () => Promise<void>) => {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid conversation ID.");
    let marker: string;
    try {
      const warnings = chatActionWarnings(accountKind, userId);
      if (warnings.some((warning) => !warning.chatId || warning.chatId === id)) {
        setActionWarnings(warnings);
        throw new ChatActionUncertainError();
      }
      marker = beginChatAction(accountKind, userId, id, action);
      setChatActionStorageError(false);
    } catch (error) {
      if (!(error instanceof ChatActionUncertainError)) setChatActionStorageError(true);
      throw error;
    }
    try {
      await dispatch();
      clearChatAction(marker);
      loadActionWarnings();
    } catch (error) {
      // A marker is only removed on a known pre-mutation rejection, or after a
      // successful response and local commit. Other failures may have committed.
      if (error instanceof ChatActionRejectedError) {
        try { clearChatAction(marker); }
        catch { loadActionWarnings(); throw new ChatActionUncertainError(); }
        loadActionWarnings();
        throw error;
      }
      loadActionWarnings();
      throw new ChatActionUncertainError();
    }
  }, [accountKind, userId, loadActionWarnings]);

  // Serialize changes to a single chat so a message, rename, and removal in
  // this tab cannot complete out of order. Different chats remain independent.
  const withChatLock = useCallback((id: string, action: () => Promise<void>) => {
    const previous = chatOperations.current.get(id);
    const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(action);
    chatOperations.current.set(id, operation);
    const cleanup = () => {
      if (chatOperations.current.get(id) === operation) chatOperations.current.delete(id);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }, []);

  // Vercel's only history/proof index is browser storage. Commit it before an
  // action resolves, because removing the active chat immediately navigates.
  const commitChatSettings = useCallback((apply: (current: AppSettings) => AppSettings) => {
    const next = apply(settingsRef.current);
    if (accountKind === "vercel") window.localStorage.setItem(storageKey, JSON.stringify(next));
    historyRevision.current += 1;
    settingsRef.current = next;
    setSettings(apply);
  }, [accountKind, storageKey]);

  const updateChat = useCallback((id: string, title: string, activity: boolean) => withChatLock(id, () => runChatMutation(id, activity ? "activity" : "rename", async () => {
    const safeTitle = title.trim().slice(0, 120) || "New conversation";
    const { response, data } = await syncFetchJson(`/api/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind, ...(accountKind === "vercel" ? { [OWNER_PROOF_HEADER]: settingsRef.current.chatProofs[id] ?? "" } : {}) },
      body: JSON.stringify({ title: safeTitle, ...(activity ? { activity: true } : {}) }),
    });
    if (!response.ok) {
      if ([400, 409, 413, 415].includes(response.status)) throw new ChatActionRejectedError();
      throw new Error("Could not confirm conversation save.");
    }
    if (!data || typeof data !== "object" || (data as {ok?: unknown}).ok !== true) throw new Error("Invalid save response.");
    const result = data as { title?: unknown };
    const updatedAt = Date.now();
    commitChatSettings((current) => {
      // Synced stores return the authoritative title, including a rename on
      // another device. Browser-only Vercel history keeps its existing title.
      const currentTitle = current.chats.find((chat) => chat.id === id)?.title;
      const savedTitle = typeof result.title === "string" ? result.title
        : accountKind === "vercel" && activity ? currentTitle ?? safeTitle : safeTitle;
      return {
        ...current,
        chats: [{ id, title: savedTitle, updatedAt }, ...current.chats.filter((chat) => chat.id !== id)].slice(0, MAX_CHATS),
      };
    });
  })), [accountKind, commitChatSettings, runChatMutation, userId, withChatLock]);

  const recordChatActivity = useCallback((id: string, initialTitle: string) =>
    updateChat(id, initialTitle, true), [updateChat]);
  const renameChat = useCallback((id: string, title: string) =>
    updateChat(id, title, false), [updateChat]);

  const removeChat = useCallback((id: string) => withChatLock(id, () => runChatMutation(id, "remove", async () => {
    const { response, data } = await syncFetchJson(`/api/chats/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: { "content-type": "application/json", "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind, ...(accountKind === "vercel" ? { [OWNER_PROOF_HEADER]: settingsRef.current.chatProofs[id] ?? "" } : {}) },
    });
    if (!response.ok) {
      if ([400, 409, 413, 415].includes(response.status)) throw new ChatActionRejectedError();
      throw new Error("Could not confirm conversation removal.");
    }
    if (!data || typeof data !== "object" || (data as {ok?: unknown}).ok !== true) throw new Error("Invalid removal response.");
    commitChatSettings((current) => {
      const chatProofs = { ...current.chatProofs };
      delete chatProofs[id];
      return { ...current, chatProofs, chats: current.chats.filter((chat) => chat.id !== id) };
    });
  })), [accountKind, commitChatSettings, runChatMutation, userId, withChatLock]);

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
    providerStatusRequest.current.controller.abort();
    const request = { controller: new AbortController(), sequence: providerStatusRequest.current.sequence + 1 };
    providerStatusRequest.current = request;
    try {
      const { response, data } = await fetchCatalogJson("/api/providers", {
        cache: "no-store", signal: request.controller.signal,
        headers: { "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind },
      });
      if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid provider status.");
      const providers = (data as { providers?: unknown }).providers;
      if (!Array.isArray(providers) || providers.length > 100) throw new Error("Invalid provider status.");
      const next: Record<string, boolean> = {};
      for (const entry of providers) {
        if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.envConfigured !== "boolean" || !getProvider(entry.id)) throw new Error("Invalid provider status.");
        next[entry.id] = entry.envConfigured;
      }
      if (providerStatusRequest.current === request && historyIdentity.current === identity && !request.controller.signal.aborted) setEnvSnapshot({ identity, values: next });
    } catch {
      if (providerStatusRequest.current === request && historyIdentity.current === identity && !request.controller.signal.aborted)
        setEnvSnapshot({ identity, values: {} });
    }
  }, [accountKind, userId, identity]);

  useEffect(() => {
    void refreshStatus();
    return () => { providerStatusRequest.current.controller.abort(); };
  }, [refreshStatus]);

  useEffect(() => {
    for (const [id, request] of modelRequests.current) {
      if (request.identity !== identity || settings.connections[id]?.token !== request.token) {
        request.controller.abort();
        modelRequests.current.delete(id);
      }
    }
  }, [settings.connections, identity]);

  useEffect(() => () => {
    for (const request of modelRequests.current.values()) request.controller.abort();
    modelRequests.current.clear();
  }, []);

  const loadModels = useCallback(async (providerId: string, force = false) => {
    const provider = getProvider(providerId);
    if (!provider) return;
    const token = settingsRef.current.connections[providerId]?.token;
    const previous = modelRequests.current.get(providerId);
    // One automatic attempt per credential, even offline; Refresh retries.
    if (!force && previous && previous.token === token && previous.identity === identity) return;
    previous?.controller.abort();
    const request = { token, identity, controller: new AbortController() };
    modelRequests.current.set(providerId, request);
    const current = () => modelRequests.current.get(providerId) === request && !request.controller.signal.aborted && historyIdentity.current === identity && settingsRef.current.connections[providerId]?.token === token;
    setModelsState((value) => ({ ...value, [providerId]: { loading: true, source: "static", token, identity } }));
    try {
      const { response, data } = await fetchCatalogJson(`/api/providers/models?provider=${encodeURIComponent(providerId)}`, {
        cache: "no-store", signal: request.controller.signal,
        headers: { "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind, ...(token ? { [HEADER_TOKEN]: token } : {}) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid model list.");
      const payload = data as { ok?: unknown; providerId?: unknown; models?: unknown; source?: unknown; error?: unknown };
      if ((payload.providerId !== undefined && payload.providerId !== providerId) ||
          (payload.source !== "live" && payload.source !== "static") ||
          !Array.isArray(payload.models) || payload.models.length > 400 ||
          (payload.source === "live" && (payload.models.length === 0 || payload.ok === false)) ||
          (payload.error !== undefined && (typeof payload.error !== "string" || payload.error.length > 300))) throw new Error("Invalid model list.");
      const seen = new Set<string>();
      const models: ModelInfo[] = [];
      for (const candidate of payload.models) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid model list.");
        const item = candidate as Record<string, unknown>;
        if (typeof item.id !== "string" || !/^[A-Za-z0-9._:/@+\-]{1,180}$/.test(item.id) || seen.has(item.id) ||
          (item.name !== undefined && (typeof item.name !== "string" || item.name.length > 200)) ||
          (item.contextWindow !== undefined && (typeof item.contextWindow !== "number" || !Number.isInteger(item.contextWindow) || item.contextWindow < 4096 || item.contextWindow > 4_000_000)) ||
          [item.inputPrice, item.outputPrice].some((value) => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) ||
          [item.free, item.vision].some((value) => value !== undefined && typeof value !== "boolean")) throw new Error("Invalid model list.");
        seen.add(item.id);
        models.push({ id: item.id, ...(typeof item.name === "string" ? { name: item.name } : {}),
          ...(typeof item.contextWindow === "number" ? { contextWindow: item.contextWindow } : {}),
          ...(typeof item.inputPrice === "number" ? { inputPrice: item.inputPrice } : {}),
          ...(typeof item.outputPrice === "number" ? { outputPrice: item.outputPrice } : {}),
          ...(typeof item.free === "boolean" ? { free: item.free } : {}), ...(typeof item.vision === "boolean" ? { vision: item.vision } : {}) });
      }
      if (!current()) return;
      setLiveModels((value) => ({ ...value, [providerId]: { token, identity, models } }));
      setModelsState((value) => ({ ...value, [providerId]: { loading: false, source: payload.source as "live" | "static", token, identity,
        ...(typeof payload.error === "string" ? { error: payload.error } : {}) } }));
    } catch (error) {
      if (!current()) return;
      setLiveModels((value) => { const next = { ...value }; delete next[providerId]; return next; });
      const message = error instanceof Error && /^HTTP \d{3}$/.test(error.message) ? error.message : translate(settingsRef.current.language, "modelCatalogUnavailable");
      setModelsState((value) => ({ ...value, [providerId]: { loading: false, source: "static", token, identity, error: message } }));
    }
  }, [accountKind, userId, identity]);

  const modelsFor = useCallback(
    (providerId: string): readonly ModelInfo[] => {
      const entry = liveModels[providerId];
      return entry && entry.identity === identity && entry.token === settings.connections[providerId]?.token ? entry.models : getProvider(providerId)?.models ?? [];
    }, [liveModels, settings.connections],
  );

  const modelsStateFor = useCallback(
    (providerId: string): ModelsState => {
      const state = modelsState[providerId];
      return state && state.identity === identity && state.token === settings.connections[providerId]?.token ? state : { loading: false, source: "static" };
    }, [modelsState, settings.connections],
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
  const loadOAuthRenewalWarnings = useCallback(() => {
    try {
      setOAuthRenewalWarnings(renewalMarkers(accountKind, userId).filter((item) => item.state === "pending"));
    } catch { setOAuthRenewalUnavailable(true); }
  }, [accountKind, userId]);

  // Human attestation does not prove the old provider request has stopped.
  // Require a different saved sealed grant and the same browser lock as renew.
  const reviewOAuthRenewal = useCallback(async (integrationId: string): Promise<boolean> => {
    try {
      const locks = navigator.locks;
      if (!locks?.request) { setOAuthRenewalUnavailable(true); return false; }
      return await locks.request(renewalLockName(accountKind, userId, integrationId), { ifAvailable: true }, async (lock) => {
        if (!lock) return false;
        const record = settingsRef.current.integrationTokens[integrationId];
        if (!record?.token) return false;
        const fingerprint = await renewalFingerprint(record.token);
        const markers = renewalMarkers(accountKind, userId);
        if (markers.some((item) => !item.integrationId)) return false;
        const held = markers.filter((item) => item.state === "pending" && item.integrationId === integrationId);
        if (!held.length || held.some((item) => item.fingerprint === fingerprint)) return false;
        // Re-read localStorage: do not acknowledge against a stale tab copy.
        const raw = window.localStorage.getItem(storageKey);
        const disk = raw ? JSON.parse(raw) as AppSettings : undefined;
        if (disk?.integrationTokens?.[integrationId]?.token !== record.token) return false;
        for (const item of held) settleRenewal(item);
        setOAuthRenewalUnavailable(false);
        loadOAuthRenewalWarnings();
        return true;
      });
    } catch { setOAuthRenewalUnavailable(true); return false; }
  }, [accountKind, userId, storageKey, loadOAuthRenewalWarnings]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const markers = renewalMarkers(accountKind, userId);
        const raw = window.localStorage.getItem(storageKey);
        const disk = raw ? JSON.parse(raw) as AppSettings : undefined;
        const stale: string[] = [];
        for (const [id, record] of Object.entries(settings.integrationTokens)) {
          if (!record || typeof record !== "object" || !record.refreshable || typeof record.token !== "string" || record.token.length > 16_000) continue;
          const hash = await renewalFingerprint(record.token);
          if (markers.some((item) => item.state === "settled" && item.integrationId === id && item.fingerprint === hash) ||
              disk?.integrationTokens?.[id]?.token !== record.token) stale.push(id);
        }
        if (!cancelled) setOAuthRenewalStale(stale);
      } catch { if (!cancelled) setOAuthRenewalUnavailable(true); }
    })();
    return () => { cancelled = true; };
  }, [hydrated, accountKind, userId, storageKey, settings.integrationTokens]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    loadOAuthRenewalWarnings();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("tflash:sync-uncertain:oauth-refresh:")) loadOAuthRenewalWarnings();
      if (event.key !== null && event.key !== storageKey && !event.key.startsWith("tflash:sync-uncertain:oauth-refresh:")) return;
      // Another tab can replace a grant or settle its tombstone even when its
      // expiry is far away. Flag a stale view without copying over local edits.
      const snapshot = settingsRef.current.integrationTokens;
      void (async () => {
        try {
          const markers = renewalMarkers(accountKind, userId);
          const raw = window.localStorage.getItem(storageKey);
          const disk = raw ? JSON.parse(raw) as AppSettings : undefined;
          const stale: string[] = [];
          for (const [id, record] of Object.entries(snapshot)) {
            if (!record || typeof record !== "object" || !record.refreshable || typeof record.token !== "string" || record.token.length > 16_000) continue;
            const hash = await renewalFingerprint(record.token);
            if (markers.some((item) => item.state === "settled" && item.integrationId === id && item.fingerprint === hash) ||
                disk?.integrationTokens?.[id]?.token !== record.token) stale.push(id);
          }
          if (!cancelled) setOAuthRenewalStale((prior) => [...new Set([...prior, ...stale.filter((id) => settingsRef.current.integrationTokens[id]?.token === snapshot[id]?.token)])]);
        } catch { if (!cancelled) setOAuthRenewalUnavailable(true); }
      })();
    };
    window.addEventListener("storage", onStorage);

    const renew = async () => {
      const current = settingsRef.current.integrationTokens;
      const now = Date.now();
      for (const [integrationId, record] of Object.entries(current)) {
        if (cancelled) return;
        if (!record || typeof record !== "object" || !record.refreshable || refreshingRef.current.has(integrationId)) continue;
        if (!getIntegration(integrationId) || typeof record.token !== "string" || !record.token.startsWith("v1.") || record.token.length > 16_000) {
          setOAuthRenewalUnavailable(true); continue;
        }
        const due = typeof record.tokenExpiresAt === "number" ? record.tokenExpiresAt - now < 10 * 60 * 1000
          : typeof record.lastRenewalAt !== "number" || !Number.isFinite(record.lastRenewalAt) || now - record.lastRenewalAt >= 12 * 60 * 60 * 1000;
        if (!due) continue;
        refreshingRef.current.add(integrationId);
        try {
          const locks = navigator.locks;
          if (!locks?.request) { setOAuthRenewalUnavailable(true); continue; }
          await locks.request(renewalLockName(accountKind, userId, integrationId), { ifAvailable: true }, async (lock) => {
            if (!lock || cancelled) return;
            const fingerprint = await renewalFingerprint(record.token);
            if (cancelled || settingsRef.current.integrationTokens[integrationId]?.token !== record.token) return;
            const records = renewalMarkers(accountKind, userId);
            if (records.some((item) => item.state === "pending" && (!item.integrationId || item.integrationId === integrationId))) {
              loadOAuthRenewalWarnings(); return;
            }
            if (records.some((item) => item.state === "settled" && item.integrationId === integrationId && item.fingerprint === fingerprint)) {
              setOAuthRenewalStale((ids) => ids.includes(integrationId) ? ids : [...ids, integrationId]);
              return;
            }
            const raw = window.localStorage.getItem(storageKey);
            const disk = raw ? JSON.parse(raw) as AppSettings : undefined;
            if (disk?.integrationTokens?.[integrationId]?.token !== record.token) {
              setOAuthRenewalStale((ids) => ids.includes(integrationId) ? ids : [...ids, integrationId]);
              return;
            }
            const key = beginRenewal(accountKind, userId, integrationId, fingerprint);
            setOAuthRenewalUnavailable(false);
            const marker: RenewalMarker = { key, integrationId, fingerprint, state: "pending" };
            try {
              const { response, data } = await syncFetchJson("/api/integrations/oauth/refresh", {
                method: "POST", headers: { "content-type": "application/json", "x-tflash-expected-user-id": userId, "x-tflash-expected-account-kind": accountKind },
                body: JSON.stringify({ token: record.token }),
              });
              const payload = data as { ok?: unknown; token?: unknown; expiresAt?: unknown; tokenExpiresAt?: unknown } | undefined;
              if (!response.ok || !payload || payload.ok !== true || typeof payload.token !== "string" || !payload.token.startsWith("v1.") || payload.token.length > 16_000 ||
                  (payload.expiresAt !== undefined && (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt))) ||
                  (payload.tokenExpiresAt !== undefined && (typeof payload.tokenExpiresAt !== "number" || !Number.isFinite(payload.tokenExpiresAt)))) {
                throw new Error("Renewal outcome unknown.");
              }
              if (cancelled) return; // A later mount must review the unresolved marker.
              const latestRaw = window.localStorage.getItem(storageKey);
              const latest = latestRaw ? JSON.parse(latestRaw) as AppSettings : undefined;
              // A disconnected/reconnected grant must never be resurrected.
              if (latest?.integrationTokens?.[integrationId]?.token !== record.token || settingsRef.current.integrationTokens[integrationId]?.token !== record.token) {
                settleRenewal(marker); loadOAuthRenewalWarnings(); return;
              }
              const { tokenExpiresAt: _previousExpiry, ...previous } = record;
              const updated: IntegrationTokenRecord = { ...previous, token: payload.token, lastRenewalAt: Date.now(),
                ...(typeof payload.expiresAt === "number" ? { expiresAt: payload.expiresAt } : {}),
                ...(typeof payload.tokenExpiresAt === "number" ? { tokenExpiresAt: payload.tokenExpiresAt } : {}) };
              window.localStorage.setItem(storageKey, JSON.stringify({ ...latest, integrationTokens: { ...latest.integrationTokens, [integrationId]: updated } }));
              // Tombstone the old sealed credential after the new one is durable.
              settleRenewal(marker);
              settingsRef.current = { ...settingsRef.current, integrationTokens: { ...settingsRef.current.integrationTokens, [integrationId]: updated } };
              setSettings((value) => value.integrationTokens[integrationId]?.token !== record.token ? value : ({
                ...value, integrationTokens: { ...value.integrationTokens, [integrationId]: updated },
              }));
              setOAuthRenewalStale((ids) => ids.filter((id) => id !== integrationId));
              loadOAuthRenewalWarnings();
            } catch {
              // Keep both the old credential and the durable pending marker.
              if (!cancelled) loadOAuthRenewalWarnings();
            }
          });
        } catch { if (!cancelled) setOAuthRenewalUnavailable(true); }
        finally { refreshingRef.current.delete(integrationId); }
      }
    };

    void renew();
    const timer = window.setInterval(() => void renew(), 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("storage", onStorage); };
  }, [hydrated, accountKind, userId, storageKey, loadOAuthRenewalWarnings]);

  const value: SettingsContextValue = {
    accountId: userId,
    accountKind,
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
    ...(oauthNoticeIdentity === identity && oauthError ? { oauthError } : {}),
    ...(oauthNoticeIdentity === identity && oauthJustConnected ? { oauthJustConnected } : {}),
    clearOAuthNotice,
    refreshStatus,
    recordChatActivity,
    renameChat,
    removeChat,
    refreshChats,
    registerChatProof,
    historyError,
    chatActionWarnings: actionWarnings,
    chatActionStorageError,
    acknowledgeChatAction,
    oauthHandoffWarnings: handoffWarningIdentity === identity ? oauthHandoffWarnings : [],
    oauthHandoffUnavailable: handoffWarningIdentity === identity && oauthHandoffUnavailable,
    reviewOAuthHandoff,
    oauthRenewalWarnings,
    oauthRenewalStale,
    oauthRenewalUnavailable,
    reviewOAuthRenewal,
    clearConnections,
    clearLocalCredentials,
  };

  return <SettingsContext.Provider value={value}><WorkspaceProvider kind={accountKind} userId={userId}>{children}</WorkspaceProvider></SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return context;
}

