"use client";

import {
  LogOutIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
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
}: {
  readonly account?: Account;
  readonly activeChatId?: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNewChat: () => void;
  readonly onOpenSettings: () => void;
}) {
  const { settings, t, hydrated, accountId, accountKind, renameChat, removeChat, historyError, refreshChats, chatActionWarnings, chatActionStorageError, acknowledgeChatAction } = useAppSettings();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<ChatAction | null>(null);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<"historySaveFailed" | "historyRemoveFailed" | "chatActionUncertain">();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const contentSearch = useChatSearch({
    query, chats: settings.chats, proofs: settings.chatProofs, accountId, accountKind, hydrated,
  });
  const groups = useMemo(() => groupChats(contentSearch.chats), [contentSearch.chats]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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
      if (action.kind === "rename") {
        await renameChat(action.chat.id, title);
      } else {
        await removeChat(action.chat.id);
      }
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
          "fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        id="conversation-sidebar"
        className={cn(
          "tf-safe-x fixed inset-y-0 left-0 z-50 flex w-[min(17.5rem,86vw)] flex-col border-r border-border/70 bg-[linear-gradient(180deg,rgba(26,24,23,0.96),rgba(18,17,16,0.97))] text-foreground transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[17.5rem] lg:translate-x-0",
          open ? "visible translate-x-0 shadow-2xl lg:shadow-none" : "invisible -translate-x-full lg:visible",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-white/8 px-3.5">
          <button
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-opacity hover:opacity-80"
            onClick={onNewChat}
            type="button"
          >
            <FlashLockup className="text-white" markClassName="size-6" wordmarkClassName="text-[14px]" />
          </button>
          <button
            ref={closeButtonRef}
            aria-label={t("closeMenu")}
            className="-mr-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground lg:hidden"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="px-3 pb-2 pt-3">
          <button
            className="flex h-11 w-full items-center gap-2 rounded-xl border border-[#f3bd56]/40 bg-[linear-gradient(135deg,#f3bd56,#f4c97f)] px-2.5 text-[13px] font-semibold text-[#1d1a17] shadow-[0_12px_24px_-18px_rgba(243,189,86,0.9)] transition-transform hover:-translate-y-0.5 lg:h-10"
            onClick={onNewChat}
            type="button"
          >
            <MessageSquarePlusIcon className="size-4" />
            {t("newChat")}
            <kbd className="ml-auto hidden rounded border border-[#1d1a17]/15 bg-[#fff2d1] px-1 py-0.5 font-sans text-[10px] text-[#3f352b] sm:block">
              ⌘⇧O
            </kbd>
          </button>
        </div>

        <div className="px-3 pb-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              aria-label={t("searchChats")}
              className="h-10 w-full rounded-xl border border-white/8 bg-white/4 pr-11 pl-8 text-[13px] text-foreground placeholder:text-muted-foreground/80 transition-colors focus:border-[#f3bd56]/55 focus:bg-white/5 focus:outline-none focus:ring-2 focus:ring-[#f3bd56]/20"
              onChange={(event) => setQuery(event.target.value)}
              maxLength={MAX_MESSAGE_QUERY_LENGTH}
              placeholder={t("searchChats")}
              type="search"
              value={query}
            />
            {query.length > 0 ? <button
              aria-label={t("clearChatSearch")}
              className="absolute inset-y-0 right-0 flex min-w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
              onClick={() => { setQuery(""); searchInputRef.current?.focus(); }} type="button"
            ><XIcon className="size-4" aria-hidden="true" /></button> : null}
          </div>
        </div>

        <div aria-live="polite" className="px-3 pt-2 text-xs leading-relaxed text-muted-foreground" role="status">
          {contentSearch.tooShort ? <p className="py-1">{t("searchMessagesMinimum")}</p> : null}
          {contentSearch.searching ? (
            <p className="py-1 flex items-center gap-2">{t("searchingMessages")} <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#f3bd56]"> <SparklesIcon className="size-3" /> {contentSearch.completed}/{contentSearch.total}</span></p>
          ) : null}
          {contentSearch.finished && contentSearch.failed === 0 ? (
            <p className="py-1">{t("searchMessagesComplete")}<button className="inline-flex min-h-10 items-center rounded px-1 underline focus-visible:outline focus-visible:outline-2 lg:min-h-8" onClick={contentSearch.retry} type="button">{t("retry")}</button></p>
          ) : null}
          {!contentSearch.searching && contentSearch.failed > 0 ? (
            <p className="py-1">{t("searchMessagesIncomplete")} ({contentSearch.failed})<button className="inline-flex min-h-10 items-center rounded px-1 underline focus-visible:outline focus-visible:outline-2 lg:min-h-8" onClick={contentSearch.retry} type="button">{t("retry")}</button></p>
          ) : null}
        </div>
        {historyError ? (
          <div className="px-3 py-2 text-xs text-destructive" role="alert">
            {t(historyError)} <button className="underline" onClick={() => void refreshChats()} type="button">{t("refresh")}</button>
          </div>
        ) : null}
        {chatActionStorageError ? <p className="px-3 py-2 text-xs text-destructive" role="alert">{t("chatActionStorageUnavailable")}</p> : null}
        {chatActionWarnings.map((warning) => <ChatActionReview key={warning.key} warning={warning} acknowledge={acknowledgeChatAction} />)}
        <nav aria-label={t("chats")} className="tflash-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-white/3 px-3 py-4 text-center text-[12px] text-muted-foreground">
              {hydrated && !historyError && !contentSearch.searching && !contentSearch.tooShort && contentSearch.failed === 0 ? (
                query.trim().length > 0 ? t("noChatResults") : t("noChats")
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
              <section className="pt-3" key={group.key}>
                <h2 className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/85">
                  {t(group.key)}
                </h2>
                <ul className="space-y-1">
                  {group.chats.map((chat) => {
                    const active = chat.id === activeChatId;
                    const snippet = Object.hasOwn(contentSearch.matches, chat.id) ? contentSearch.matches[chat.id] : undefined;
                    return (
                      <li className="group/chat relative" key={chat.id}>
                        <a
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-w-0 items-center rounded-xl pr-9 pl-2.5 text-[13px] transition-all",
                            snippet ? "min-h-14 py-2" : "h-10 lg:h-9",
                            active
                              ? "bg-white/8 font-medium text-foreground shadow-inner shadow-white/5"
                              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                          )}
                          href={`/s/${encodeURIComponent(chat.id)}`}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate">{chat.title}</span>
                            {snippet ? (
                              <span className="line-clamp-2 break-words text-[11px] font-normal leading-snug text-muted-foreground">
                                {snippet.before}<mark className="rounded-sm bg-[#f3bd56]/20 text-foreground">{snippet.match}</mark>{snippet.after}
                              </span>
                            ) : null}
                          </span>
                        </a>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label={`${t("chatActions")}: ${chat.title}`}
                              className="tf-reveal absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-white/5 hover:text-foreground group-hover/chat:opacity-100"
                              type="button"
                            >
                              <MoreHorizontalIcon className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={() => openAction("rename", chat)}>
                              <PencilIcon className="size-3.5" /> {t("renameChat")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openAction("remove", chat)} variant="destructive">
                              <Trash2Icon className="size-3.5" /> {t("deleteChat")}
                            </DropdownMenuItem>
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

        <div className="tf-safe-bottom shrink-0 border-t border-white/8 bg-white/2 p-2">
          <button
            className="flex h-10 w-full items-center gap-2.5 rounded-xl px-2 text-[13px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground lg:h-8"
            onClick={onOpenSettings}
            type="button"
          >
            <Settings2Icon className="size-4 shrink-0" />
            {t("settings")}
          </button>
          {account ? (
            <AccountMenu account={account} />
          ) : (
            <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground/70">{t("poweredBy")}</p>
          )}
        </div>
      </aside>

      <Dialog onOpenChange={(nextOpen) => { if (!nextOpen && !pending) setAction(null); }} open={action !== null}>
        <DialogContent closeLabel={t("dismiss")} showCloseButton={!pending}>
          {action ? (
            <form className="space-y-5" onSubmit={submitAction}>
              <DialogHeader>
                <DialogTitle>{action.kind === "rename" ? t("renameChat") : t("deleteChat")}</DialogTitle>
                <DialogDescription>
                  {action.kind === "rename" ? t("renameChatHint") : t("removeChatHint")}
                </DialogDescription>
              </DialogHeader>
              {action.kind === "rename" ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="chat-title">{t("chatName")}</label>
                  <Input autoFocus id="chat-title" maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} />
                </div>
              ) : (
                <p className="break-words rounded-md bg-muted px-3 py-2 text-sm">{action.chat.title}</p>
              )}
              {actionError ? <p className="text-sm text-destructive" role="alert">{t(actionError)}</p> : null}
              <DialogFooter>
                <Button disabled={pending} onClick={() => setAction(null)} type="button" variant="outline">{t("cancel")}</Button>
                <Button disabled={pending || (action.kind === "rename" && !title.trim())} type="submit" variant={action.kind === "remove" ? "destructive" : "default"}>
                  {pending ? "…" : action.kind === "rename" ? t("save") : t("remove")}
                </Button>
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
  return <div className="mx-3 mb-2 rounded-xl border border-destructive/50 bg-destructive/5 p-2 text-xs" role="alert">
    <p>{t("chatActionUncertain")}</p>
    <p className="mt-1 break-all font-medium">{label}: {warning.chatId ?? t("chatActionUnknown")}</p>
    <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />{t("chatActionReviewLabel")}</label>
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
      if (supabaseResult.status === "rejected" || supabaseResult.value.error ||
          vercelResult.status === "rejected" || vercelResult.value.error) {
        throw new Error("Sign-out incomplete");
      }
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
        <button
          className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-white/5 lg:h-9"
          type="button"
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/8 text-[10px] font-medium text-muted-foreground ring-1 ring-white/10">
            {account.image && !imageFailed ? (
              <img
                alt=""
                className="size-full object-cover"
                onError={() => setImageFailed(true)}
                src={account.image}
              />
            ) : (
              initials
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-[13px] text-foreground">{account.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{account.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" side="top">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.08em]">
          {t("account")}
        </DropdownMenuLabel>
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
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? email[0] ?? "?").toUpperCase();
}

