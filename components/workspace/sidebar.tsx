"use client";

import {
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
import { groupChats, searchChats } from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import { useAppSettings, type ChatRecord } from "@/components/settings/app-settings";
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
  const { settings, t, renameChat, removeChat, historyError, refreshChats } = useAppSettings();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<ChatAction | null>(null);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<"historySaveFailed" | "historyRemoveFailed">();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const groups = useMemo(
    () => groupChats(searchChats(settings.chats, query)),
    [settings.chats, query],
  );

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
    } catch {
      setActionError(action.kind === "rename" ? "historySaveFailed" : "historyRemoveFailed");
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
          "tf-safe-x fixed inset-y-0 left-0 z-50 flex w-[min(17.5rem,86vw)] flex-col bg-sidebar transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[17.5rem] lg:translate-x-0",
          "tflash-hairline",
          open ? "visible translate-x-0 shadow-xl lg:shadow-none" : "invisible -translate-x-full lg:visible",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3.5">
          <button
            className="flex items-center gap-2 rounded-md text-left transition-opacity hover:opacity-75"
            onClick={onNewChat}
            type="button"
          >
            <FlashLockup />
          </button>
          <button
            ref={closeButtonRef}
            aria-label={t("closeMenu")}
            className="-mr-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            onClick={onClose}
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-border/80 bg-card px-2.5 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-accent lg:h-9"
            onClick={onNewChat}
            type="button"
          >
            <MessageSquarePlusIcon className="size-4 text-muted-foreground" />
            {t("newChat")}
            <kbd className="ml-auto hidden rounded border border-border/70 bg-muted px-1 py-0.5 font-sans text-[10px] text-muted-foreground sm:block">
              ⌘⇧O
            </kbd>
          </button>
        </div>

        <div className="px-3 pb-1">
          <label className="relative block">
            <span className="sr-only">{t("searchChats")}</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-md bg-transparent pr-2 pl-8 text-[13px] text-foreground placeholder:text-muted-foreground/80 focus:bg-card focus:ring-1 focus:ring-border focus:outline-none lg:h-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchChats")}
              type="search"
              value={query}
            />
          </label>
        </div>

        {historyError ? (
          <div className="px-3 py-2 text-xs text-destructive" role="alert">
            {t(historyError)} <button className="underline" onClick={() => void refreshChats()} type="button">{t("refresh")}</button>
          </div>
        ) : null}
        <nav aria-label={t("chats")} className="tflash-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.length === 0 ? (
            <p className="px-2.5 py-6 text-pretty text-muted-foreground text-xs leading-relaxed">
              {query.trim().length > 0 ? t("noChatResults") : t("noChats")}
            </p>
          ) : (
            groups.map((group) => (
              <section className="pt-3" key={group.key}>
                <h2 className="px-2.5 pb-1 font-medium text-[11px] text-muted-foreground/85 uppercase tracking-[0.08em]">
                  {t(group.key)}
                </h2>
                <ul className="space-y-px">
                  {group.chats.map((chat) => {
                    const active = chat.id === activeChatId;
                    return (
                      <li className="group/chat relative" key={chat.id}>
                        <a
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-10 items-center rounded-md pr-9 pl-2.5 text-[13px] transition-colors lg:h-8",
                            active
                              ? "bg-accent font-medium text-foreground"
                              : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                          )}
                          href={`/s/${encodeURIComponent(chat.id)}`}
                        >
                          <span className="truncate">{chat.title}</span>
                        </a>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label={`${t("chatActions")}: ${chat.title}`}
                              className="tf-reveal absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover/chat:opacity-100 lg:size-6"
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

        <div className="tf-safe-bottom shrink-0 border-t border-border/70 p-2">
          <button
            className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-8"
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
      // Both cookie sets can be present at once. Do not claim success if
      // either sign-out failed, or if an authenticated session remains.
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
          className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-accent lg:h-9"
          type="button"
        >
          <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
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
            <span className="block truncate font-medium text-[13px] text-foreground">
              {account.name}
            </span>
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
