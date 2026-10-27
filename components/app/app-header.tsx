"use client";

import {
  ChevronDownIcon,
  Clock3Icon,
  DownloadIcon,
  HistoryIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  PlusIcon,
  Settings2Icon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { getProvider } from "@/lib/providers/catalog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ProviderBadge, StatusDot } from "./provider-badge";
import { useAppSettings, type Theme } from "./settings-provider";

export function AppHeader({
  onNewChat,
  onOpenSettings,
  onOpenModels,
  onExportChat,
  canExport = false,
}: {
  readonly onNewChat: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
  readonly onExportChat: () => void;
  readonly canExport?: boolean;
}) {
  const { settings, t, selection, isConnected, update, removeChat } = useAppSettings();
  const provider = getProvider(selection.providerId);
  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const ThemeIcon = settings.theme === "dark" ? MoonIcon : settings.theme === "light" ? SunIcon : Clock3Icon;

  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-30 h-14">
      <div className="pointer-events-auto relative mx-auto flex h-full max-w-5xl items-center gap-2 border-border/60 bg-background/85 px-3 backdrop-blur-xl sm:px-5">
        <button
          className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:opacity-80"
          onClick={onNewChat}
          type="button"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
            <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
              <path
                d="M4 18V7.5L12 4l8 3.5V18l-8 3-8-3Z"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
              <path d="M4 7.5 12 11l8-3.5M12 11v10" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
          <span className="hidden font-semibold text-sm tracking-tight sm:block">ururka</span>
        </button>

        <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />

        <button
          className="flex min-w-0 items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-xs transition-colors hover:border-foreground/30"
          onClick={onOpenModels}
          title={t("modelPickerHint")}
          type="button"
        >
          {provider ? <ProviderBadge provider={provider} size="sm" /> : null}
          <StatusDot active={isConnected(selection.providerId)} />
          <span className="max-w-[9rem] truncate font-medium sm:max-w-[14rem]">
            {selection.modelId}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t("history")} size="icon-sm" type="button" variant="ghost">
                <HistoryIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                <Clock3Icon className="size-3" />
                {t("recentChats")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {settings.chats.length === 0 ? (
                <p className="px-2 py-3 text-center text-muted-foreground text-xs">
                  {t("noHistory")}
                </p>
              ) : (
                settings.chats.slice(0, 12).map((chat) => (
                  <DropdownMenuItem
                    className="group flex items-center gap-2 text-xs"
                    key={chat.id}
                    onSelect={() => window.location.assign(`/s/${encodeURIComponent(chat.id)}`)}
                  >
                    <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                    <button
                      aria-label={t("deleteChat")}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeChat(chat.id);
                      }}
                      type="button"
                    >
                      <Trash2Icon className="size-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              {canExport ? (
                <DropdownMenuItem className="cursor-pointer text-xs" onSelect={onExportChat}>
                  <DownloadIcon className="size-3" />
                  {t("exportChat")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            aria-label={t("theme")}
            onClick={() => update({ theme: nextTheme[settings.theme] })}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ThemeIcon className="size-4" />
          </Button>

          <Button
            aria-label={t("settings")}
            onClick={onOpenSettings}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Settings2Icon className="size-4" />
          </Button>

          <Button
            className={cn("ml-1 h-8 px-2.5 text-xs")}
            onClick={onNewChat}
            size="sm"
            type="button"
            variant="outline"
          >
            <MessageSquarePlusIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("newChat")}</span>
            <PlusIcon className="size-3 sm:hidden" />
          </Button>
        </div>
      </div>
    </header>
  );
}
