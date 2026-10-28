"use client";

import {
  LogOutIcon,
  MessageSquarePlusIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  Settings2Icon,
  SunIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { FlashLockup } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { groupChats, searchChats } from "@/lib/chat-history";
import { cn } from "@/lib/utils";
import { useAppSettings, type Theme } from "@/components/settings/app-settings";
import { authClient } from "@/lib/auth-client";

export type Account = {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
};

export function Sidebar({
  account,
  activeChatId,
  open,
  onClose,
  onNewChat,
  onOpenConnections,
  onOpenSettings,
}: {
  readonly account?: Account;
  readonly activeChatId?: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNewChat: () => void;
  readonly onOpenConnections: () => void;
  readonly onOpenSettings: () => void;
}) {
  const { settings, t, removeChat, update } = useAppSettings();
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => groupChats(searchChats(settings.chats, query)),
    [settings.chats, query],
  );
  const themeIcon =
    settings.theme === "dark" ? MoonIcon : settings.theme === "light" ? SunIcon : MonitorIcon;
  const ThemeIcon = themeIcon;
  const nextTheme: Record<Theme, Theme> = { dark: "light", light: "system", system: "dark" };

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
        className={cn(
          // On a phone the drawer takes most of the width but never all of it,
          // so the conversation stays visible behind the scrim.
          "tf-safe-x fixed inset-y-0 left-0 z-50 flex w-[min(17.5rem,86vw)] flex-col bg-sidebar transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[17.5rem] lg:translate-x-0",
          "tflash-hairline",
          open ? "translate-x-0 shadow-xl lg:shadow-none" : "-translate-x-full",
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

        <nav aria-label={t("chats")} className="tflash-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.length === 0 ? (
            <p className="px-2.5 py-6 text-pretty text-muted-foreground text-xs leading-relaxed">
              {query.trim().length > 0 ? t("noHistory") : t("noChats")}
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
                          className={cn(
                            "flex h-10 items-center rounded-md pr-8 pl-2.5 text-[13px] transition-colors lg:h-8",
                            active
                              ? "bg-accent font-medium text-foreground"
                              : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                          )}
                          href={`/s/${encodeURIComponent(chat.id)}`}
                        >
                          <span className="truncate">{chat.title}</span>
                        </a>
                        <button
                          aria-label={t("deleteChat")}
                          className="tf-reveal absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive focus-visible:opacity-100 group-hover/chat:opacity-100 lg:size-6"
                          onClick={() => removeChat(chat.id)}
                          type="button"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
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
            onClick={onOpenConnections}
            type="button"
          >
            <WrenchIcon className="size-4 shrink-0" />
            {t("connections")}
          </button>
          <button
            className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-8"
            onClick={onOpenSettings}
            type="button"
          >
            <Settings2Icon className="size-4 shrink-0" />
            {t("settings")}
          </button>
          <button
            className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-8"
            onClick={() => update({ theme: nextTheme[settings.theme] })}
            type="button"
          >
            <ThemeIcon className="size-4 shrink-0" />
            {t("theme")}
            <span className="ml-auto text-[11px] text-muted-foreground/70">{t(settings.theme)}</span>
          </button>

          {account ? (
            <AccountMenu account={account} />
          ) : (
            <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground/70">
              {t("poweredBy")}
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

function AccountMenu({ account }: { readonly account: Account }) {
  const { t } = useAppSettings();
  const [imageFailed, setImageFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const initials = getInitials(account.name, account.email);

  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onError: () => setPending(false),
          onSuccess: () => window.location.assign("/"),
        },
      });
    } catch {
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
        <DropdownMenuItem className="text-[13px]" disabled={pending} onSelect={signOut}>
          <LogOutIcon className="size-3.5" />
          {pending ? "…" : t("signOut")}
        </DropdownMenuItem>
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
