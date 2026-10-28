"use client";

import {
  ChevronDownIcon, ChevronRightIcon, CircleHelpIcon, DownloadIcon, Layers2Icon,
  LogOutIcon, MenuIcon, MessageCircleIcon, MoonIcon, PlusIcon, Settings2Icon,
  SunIcon, Trash2Icon, UnplugIcon, XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { browserSupabase } from "@/lib/supabase/browser";
import { getProvider } from "@/lib/providers/catalog";
import { Brand } from "./brand";
import { StatusDot } from "./provider-badge";
import { useAppSettings, type Theme } from "./settings-provider";

export type AppUser = { readonly id: string; readonly name: string; readonly email: string };

export function WorkspaceShell({
  children, user, sessionId, onNewChat, onOpenModels, onOpenSettings, onExportChat, canExport,
}: {
  readonly children: ReactNode;
  readonly user: AppUser;
  readonly sessionId?: string;
  readonly onNewChat: () => void;
  readonly onOpenModels: () => void;
  readonly onOpenSettings: () => void;
  readonly onExportChat: () => void;
  readonly canExport: boolean;
}) {
  const { settings, selection, isConnected, t, update, removeChat, historyError, refreshChats } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const so = settings.language === "so";
  const provider = getProvider(selection.providerId);
  const connected = isConnected(selection.providerId);
  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    setSigningOut(true); setSignOutError(false);
    try {
      const { error } = await browserSupabase().auth.signOut();
      if (error) throw error;
      // Provider tokens are account-scoped and removed on sign-out on shared devices.
      const key = `tflash:settings:v1:${user.id}`;
      try {
        const stored = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(key, JSON.stringify({ ...stored, connections: {} }));
      } catch { /* storage may be disabled */ }
      window.location.assign("/login");
    } catch { setSignOutError(true); setSigningOut(false); }
  }

  async function remove(id: string) {
    if (!window.confirm(so ? "Ma ka saartaa wada hadalkan?" : "Remove this conversation?")) return;
    setRemoving(id);
    try {
      await removeChat(id);
      if (sessionId === id) onNewChat();
    } catch { /* the sidebar shows the error and a retry action */ }
    finally { setRemoving(undefined); }
  }

  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "T";

  return (
    <div className="workspace-shell">
      {open ? <button aria-label={so ? "Xir menu-ga" : "Close menu"} className="workspace-scrim" onClick={() => setOpen(false)} type="button" /> : null}
      <aside className={`workspace-sidebar ${open ? "is-open" : ""}`} aria-label={so ? "Menu-ga" : "Workspace navigation"}>
        <div className="workspace-brand-row">
          <button className="workspace-brand-button" onClick={onNewChat} type="button"><Brand /></button>
          <button aria-label={so ? "Xir menu-ga" : "Close menu"} className="workspace-close" onClick={() => setOpen(false)} type="button"><XIcon size={18} /></button>
        </div>
        <button className="workspace-new" onClick={() => { setOpen(false); onNewChat(); }} type="button">
          <PlusIcon size={17} strokeWidth={2} /><span>{t("newChat")}</span><span className="workspace-new-key">⌘ ⇧ O</span>
        </button>
        <div className="workspace-nav-label">{so ? "GOOBTAADA" : "WORKSPACE"}</div>
        <nav className="workspace-nav">
          <button className="is-active" onClick={() => setOpen(false)} type="button"><MessageCircleIcon size={17} /><span>{so ? "Wada hadal" : "Chat"}</span><ChevronRightIcon size={14} /></button>
          <button onClick={() => { setOpen(false); onOpenModels(); }} type="button"><Layers2Icon size={17} /><span>{t("models")}</span><span className="workspace-nav-key">⌘ K</span></button>
          <button onClick={() => { setOpen(false); onOpenSettings(); }} type="button"><UnplugIcon size={17} /><span>{t("providers")}</span></button>
        </nav>
        <div className="workspace-recent-heading"><span>{so ? "DHAWAAN" : "RECENT"}</span><span>{String(settings.chats.length).padStart(2, "0")}</span></div>
        <div className="workspace-recent ururka-scroll">
          {historyError ? <div className="workspace-history-error">{historyError}<button onClick={() => void refreshChats()} type="button">{t("refresh")}</button></div> : null}
          {!historyError && settings.chats.length === 0 ? <p className="workspace-no-chats">{so ? "Wada hadalladaadu halkan ayay ka muuqan doonaan." : "Your conversations will appear here."}</p> : null}
          {settings.chats.map((chat) => (
            <div className={`workspace-chat-row ${chat.id === sessionId ? "is-current" : ""}`} key={chat.id}>
              <a href={`/s/${encodeURIComponent(chat.id)}`} title={chat.title}><span className="workspace-chat-dot" /><span>{chat.title}</span></a>
              <button aria-label={`${t("deleteChat")}: ${chat.title}`} disabled={removing === chat.id} onClick={() => void remove(chat.id)} title={t("deleteChat")} type="button"><Trash2Icon size={14} /></button>
            </div>
          ))}
        </div>
        <div className="workspace-sidebar-bottom">
          <button className="workspace-settings-link" onClick={() => { setOpen(false); onOpenSettings(); }} type="button"><Settings2Icon size={17} /><span>{t("settings")}</span><ChevronRightIcon size={14} /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="workspace-account" type="button" aria-label={so ? "Fur akoonka" : "Open account menu"}>
                <span className="workspace-avatar">{initials}</span>
                <span className="workspace-account-copy"><strong>{user.name}</strong><small>{user.email}</small></span>
                <ChevronDownIcon size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60" side="top" sideOffset={8}>
              <div className="px-2 py-2 text-sm"><p className="truncate font-medium">{user.name}</p><p className="truncate text-xs text-muted-foreground">{user.email}</p></div>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}><LogOutIcon size={15} />{signingOut ? (so ? "Waa laga baxayaa…" : "Signing out…") : (so ? "Ka bax" : "Sign out")}</DropdownMenuItem>
              {signOutError ? <p className="px-2 py-1.5 text-xs text-destructive">{so ? "Lama bixin. Mar kale isku day." : "Could not sign out. Try again."}</p> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-topbar">
          <button aria-label={so ? "Fur menu-ga" : "Open menu"} aria-expanded={open} className="workspace-menu" onClick={() => setOpen(true)} type="button"><MenuIcon size={19} /></button>
          <div className="workspace-breadcrumb"><span>{so ? "Goobtaada" : "Workspace"}</span><ChevronRightIcon size={13} /><strong>{sessionId && settings.chats.some((chat) => chat.id === sessionId) ? (so ? "Wada hadal" : "Conversation") : t("newChat")}</strong></div>
          <div className="workspace-top-actions">
            <button className="workspace-model" onClick={onOpenModels} title={t("modelPickerHint")} type="button">
              <StatusDot active={connected} /><span className="workspace-model-provider">{provider?.name ?? "Model"}</span><span className="workspace-model-divider">/</span><strong>{selection.modelId}</strong><ChevronDownIcon size={14} />
            </button>
            {canExport ? <button aria-label={t("exportChat")} className="workspace-icon-button workspace-export" onClick={onExportChat} title={t("exportChat")} type="button"><DownloadIcon size={17} /></button> : null}
            <button aria-label={t("theme")} className="workspace-icon-button" onClick={() => update({ theme: nextTheme[settings.theme] })} title={t("theme")} type="button">{settings.theme === "dark" ? <MoonIcon size={17} /> : <SunIcon size={17} />}</button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
