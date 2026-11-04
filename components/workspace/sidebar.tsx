"use client";

import {
  FolderIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  Settings2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FlashLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { groupChats } from "@/lib/chat-history";
import { MAX_MESSAGE_QUERY_LENGTH } from "@/lib/chat-search";
import { useChatSearch } from "./use-chat-search";
import { cn } from "@/lib/utils";
import { useAppSettings, type ChatRecord } from "@/components/settings/app-settings";
import { ChatActionUncertainError, type ChatActionWarning } from "@/lib/chat-action-recovery";
import { authClient } from "@/lib/auth-client";
import { browserSupabase } from "@/lib/supabase/browser";
import { useWorkspace } from "@/components/settings/workspace-store";
import { AgentModePicker } from "@/components/chat/chat-composer";
import { agentModeStorageKey, parseAgentMode, type AgentMode } from "@/lib/agent-modes";

export type Account = {
  readonly id: string;
  readonly kind: "supabase" | "vercel";
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
};

type ChatAction = { readonly kind: "rename" | "remove"; readonly chat: ChatRecord };

export function Sidebar({
  account,
  activeChatId,
  open,
  onClose,
  onNewChat,
  onOpenSettings,
  onOpenProjects,
  mode = "chat",
  onModeChange,
}: {
  readonly account?: Account;
  readonly activeChatId?: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNewChat: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenProjects?: () => void;
  readonly mode?: AgentMode;
  readonly onModeChange?: (mode: AgentMode) => void;
}) {
  const { settings, t, hydrated, accountId, accountKind, renameChat, removeChat, historyError, refreshChats, chatActionWarnings, chatActionStorageError, acknowledgeChatAction } = useAppSettings();
  const { workspace, ready: workspaceReady } = useWorkspace();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<ChatAction | null>(null);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<"historySaveFailed" | "historyRemoveFailed" | "chatActionUncertain">();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const modeChats = useMemo(() => settings.chats.filter((chat) => {
    // Keep the open conversation visible while its stored preference loads.
    if (chat.id === activeChatId) return true;
    if (typeof window === "undefined") return mode === "chat";
    try {
      return parseAgentMode(window.localStorage.getItem(agentModeStorageKey(accountKind, accountId, chat.id))) === mode;
    } catch {
      return mode === "chat";
    }
  }), [accountId, accountKind, activeChatId, mode, settings.chats]);
  const contentSearch = useChatSearch({
    query, chats: modeChats, proofs: settings.chatProofs, accountId, accountKind, hydrated,
  });
  const groups = useMemo(() => groupChats(contentSearch.chats), [contentSearch.chats]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpenRef.current = true;
      closeButtonRef.current?.focus();
      return;
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  function openAction(kind: ChatAction["kind"], chat: ChatRecord) {
    setTitle(chat.title);
    setActionError(undefined);
    setAction({ kind, chat });
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || pending || (action.kind === "rename" && !title.trim())) return;
    if (action.kind === "rename" && title.trim() === action.chat.title) {
      setAction(null);
      return;
    }
    setPending(true);
    setActionError(undefined);
    try {
      if (action.kind === "rename") await renameChat(action.chat.id, title);
      else await removeChat(action.chat.id);
      setAction(null);
      if (action.kind === "remove" && action.chat.id === activeChatId) onNewChat();
    } catch (error) {
      setActionError(error instanceof ChatActionUncertainError ? "chatActionUncertain" : action.kind === "rename" ? "historySaveFailed" : "historyRemoveFailed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        id="conversation-sidebar"
        className={cn(
          "tf-safe-x fixed inset-y-0 left-0 z-50 flex w-[min(17rem,88vw)] flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[17rem] lg:translate-x-0",
          open ? "visible translate-x-0 shadow-2xl lg:shadow-none" : "invisible -translate-x-full lg:visible",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-3.5">
          <button className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onNewChat} type="button">
            <FlashLockup markClassName="size-6" wordmarkClassName="text-[14px]" />
          </button>
          <button
            ref={closeButtonRef}
            aria-label={t("closeMenu")}
            className="-mr-1 flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-3 pt-3 pb-3">
          <button
            className="flex h-11 w-full items-center gap-2 rounded-xl bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={onNewChat}
            type="button"
          >
            <MessageSquarePlusIcon className="size-4" />
            {t("newChat")}
            <kbd className="ml-auto hidden rounded border border-current/20 px-1 py-0.5 font-sans text-[10px] opacity-70 sm:block">⌘⇧O</kbd>
          </button>
          <section aria-label={settings.language === "so" ? "Hababka agent-ka" : "Agent modes"}>
            <AgentModePicker mode={mode} onChange={onModeChange} language={settings.language} disabled={false} />
            <p className="mt-2 px-1 text-[10px] leading-relaxed text-muted-foreground">{t("modeSessionHint")}</p>
          </section>
        </div>

        <div className="px-3 pb-1">
          <button
            aria-label={`${t("projects")}${workspaceReady && workspace.projects.length ? ` (${workspace.projects.length})` : ""}`}
            className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOpenProjects}
            type="button"
          >
            <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex-1">{t("projects")}</span>
            {workspaceReady && workspace.projects.length > 0 ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{workspace.projects.length}</span> : null}
          </button>
        </div>

        <div className="px-3 pt-2 pb-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              aria-label={t("searchChats")}
              className="h-10 w-full rounded-lg border bg-background/55 pr-11 pl-8 text-[13px] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary/45 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/10"
              onChange={(event) => setQuery(event.target.value)}
              maxLength={MAX_MESSAGE_QUERY_LENGTH}
              placeholder={t("searchChats")}
              type="search"
              value={query}
            />
            {query.length > 0 ? <button aria-label={t("clearChatSearch")} className="absolute inset-y-0 right-0 flex min-w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2" onClick={() => { setQuery(""); searchInputRef.current?.focus(); }} type="button"><XIcon className="size-4" aria-hidden="true" /></button> : null}
          </div>
        </div>

        <div aria-live="polite" className="px-3 pt-1 text-xs leading-relaxed text-muted-foreground" role="status">
          {contentSearch.tooShort ? <p className="py-1">{t("searchMessagesMinimum")}</p> : null}
          {contentSearch.searching ? <p className="flex items-center justify-between gap-2 py-1">{t("searchingMessages")} <span className="text-[10px] tabular-nums">{contentSearch.completed}/{contentSearch.total}</span></p> : null}
          {contentSearch.finished && contentSearch.failed === 0 ? (
            <p className="py-1">{t("searchMessagesComplete")}<button className="inline-flex min-h-10 items-center rounded px-1 underline focus-visible:outline focus-visible:outline-2 lg:min-h-8" onClick={contentSearch.retry} type="button">{t("searchAgain")}</button></p>
          ) : null}
          {!contentSearch.searching && contentSearch.failed > 0 ? (
            <p className="py-1">{t("searchMessagesIncomplete")} ({contentSearch.failed})<button className="inline-flex min-h-10 items-center rounded px-1 underline focus-visible:outline focus-visible:outline-2 lg:min-h-8" onClick={contentSearch.retry} type="button">{t("searchRetry")}</button></p>
          ) : null}
        </div>
        {historyError ? <div className="px-3 py-2 text-xs text-destructive" role="alert">{t(historyError)} <button className="underline" onClick={() => void refreshChats()} type="button">{t("refresh")}</button></div> : null}
        {chatActionStorageError ? <p className="px-3 py-2 text-xs text-destructive" role="alert">{t("chatActionStorageUnavailable")}</p> : null}
        {chatActionWarnings.map((warning) => <ChatActionReview key={warning.key} warning={warning} acknowledge={acknowledgeChatAction} />)}
        <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{t("history")}</div>
        <nav aria-label={t("chats")} className="tflash-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
          {groups.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] leading-relaxed text-muted-foreground">
              {hydrated && !historyError && !contentSearch.searching && !contentSearch.tooShort && contentSearch.failed === 0 ? (query.trim().length > 0 ? t("noChatResults") : t("noChats")) : null}
            </div>
          ) : (
            groups.map((group) => (
              <section className="pt-2" key={group.key}>
                <h2 className="px-2.5 pb-1 text-[10px] font-medium text-muted-foreground">{t(group.key)}</h2>
                <ul className="space-y-0.5">
                  {group.chats.map((chat) => {
                    const active = chat.id === activeChatId;
                    const snippet = Object.hasOwn(contentSearch.matches, chat.id) ? contentSearch.matches[chat.id] : undefined;
                    return (
                      <li className="group/chat relative" key={chat.id}>
                        <a
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-w-0 items-center rounded-lg pr-9 pl-2.5 text-[13px] transition-colors",
                            snippet ? "min-h-14 py-2" : "h-10 lg:h-9",
                            active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/65 hover:text-foreground",
                          )}
                          href={`/s/${encodeURIComponent(chat.id)}`}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate">{chat.title}</span>
                            {snippet ? <span className="line-clamp-2 break-words text-[11px] font-normal leading-snug text-muted-foreground">{snippet.before}<mark className="rounded-sm bg-primary/15 text-foreground">{snippet.match}</mark>{snippet.after}</span> : null}
                          </span>
                        </a>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button aria-label={`${t("chatActions")}: ${chat.title}`} className="tf-reveal absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/70 hover:text-foreground focus-visible:opacity-100 group-hover/chat:opacity-100" type="button"><MoreHorizontalIcon className="size-4" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={() => openAction("rename", chat)}><PencilIcon className="size-3.5" /> {t("renameChat")}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openAction("remove", chat)} variant="destructive"><Trash2Icon className="size-3.5" /> {t("deleteChat")}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </nav>

        <div className="tf-safe-bottom shrink-0 border-t p-2">
          <button className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9" onClick={onOpenSettings} type="button">
            <Settings2Icon className="size-4 shrink-0" />
            {t("settings")}
          </button>
          {account ? <AccountMenu account={account} /> : <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">{t("poweredBy")}</p>}
        </div>
      </aside>

      <Dialog onOpenChange={(nextOpen) => { if (!nextOpen && !pending) setAction(null); }} open={action !== null}>
        <DialogContent closeLabel={t("dismiss")} showCloseButton={!pending}>
          {action ? (
            <form className="space-y-5" onSubmit={submitAction}>
              <DialogHeader>
                <DialogTitle>{action.kind === "rename" ? t("renameChat") : t("deleteChat")}</DialogTitle>
                <DialogDescription>{action.kind === "rename" ? t("renameChatHint") : t("removeChatHint")}</DialogDescription>
              </DialogHeader>
              {action.kind === "rename" ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="chat-title">{t("chatName")}</label>
                  <Input autoFocus id="chat-title" maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} />
                </div>
              ) : <p className="break-words rounded-md bg-muted px-3 py-2 text-sm">{action.chat.title}</p>}
              {actionError ? <p className="text-sm text-destructive" role="alert">{t(actionError)}</p> : null}
              <DialogFooter>
                <Button disabled={pending} onClick={() => setAction(null)} type="button" variant="outline">{t("cancel")}</Button>
                <Button disabled={pending || (action.kind === "rename" && !title.trim())} type="submit" variant={action.kind === "remove" ? "destructive" : "default"}>{pending ? "…" : action.kind === "rename" ? t("save") : t("remove")}</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChatActionReview({ warning, acknowledge }: { readonly warning: ChatActionWarning; readonly acknowledge: (key: string) => void }) {
  const { t } = useAppSettings();
  const [reviewed, setReviewed] = useState(false);
  const label = warning.action === "activity" ? t("chatActionActivity") : warning.action === "rename" ? t("chatActionRename") : warning.action === "remove" ? t("chatActionRemove") : t("chatActionUnknown");
  return <div className="mx-3 mb-2 rounded-lg border border-destructive/35 bg-destructive/5 p-2 text-xs" role="alert">
    <p>{t("chatActionUncertain")}</p>
    <p className="mt-1 break-all font-medium text-foreground">{label}: {warning.chatId ?? t("chatActionUnknown")}</p>
    <label className="mt-2 flex items-start gap-2 text-muted-foreground"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />{t("chatActionReviewLabel")}</label>
    <Button className="mt-2 h-auto min-h-10 w-full whitespace-normal" size="sm" variant="outline" disabled={!reviewed} onClick={() => acknowledge(warning.key)} type="button">{t("chatActionReviewButton")}</Button>
  </div>;
}

function AccountMenu({ account }: { readonly account: Account }) {
  const { t, clearLocalCredentials } = useAppSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const initials = getInitials(account.name, account.email);

  async function signOut() {
    setPending(true);
    setSignOutError(false);
    try {
      const [supabaseResult, vercelResult] = await Promise.allSettled([
        browserSupabase().auth.signOut({ scope: "local" }),
        authClient.signOut(),
      ]);
      if (supabaseResult.status === "rejected" || supabaseResult.value.error || vercelResult.status === "rejected" || vercelResult.value.error) throw new Error("Sign-out incomplete");
      const check = await fetch("/api/chats", { cache: "no-store" });
      if (check.status !== 401) throw new Error("Session still active");
      clearLocalCredentials();
      window.location.assign("/login");
    } catch {
      setSignOutError(true);
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10" type="button">
          <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/12 text-[10px] font-semibold text-primary ring-1 ring-primary/15">
            {account.image && !imageFailed ? <img alt="" className="size-full object-cover" onError={() => setImageFailed(true)} src={account.image} /> : initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-[13px] text-foreground">{account.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{account.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="top">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.08em]">{t("account")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-[13px]" disabled={pending} onSelect={(event) => { event.preventDefault(); void signOut(); }}>
          <LogOutIcon className="size-3.5" />
          {pending ? "…" : t("signOut")}
        </DropdownMenuItem>
        {signOutError ? <p role="alert" className="px-2 py-1 text-xs text-destructive">{t("signOutFailed")}</p> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (parts[0]?.[0] ?? email[0] ?? "?").toUpperCase();
}
