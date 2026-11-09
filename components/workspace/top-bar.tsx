"use client";

import {
  DownloadIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Settings2Icon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppSettings } from "@/components/settings/app-settings";
import { useEffect } from "react";
import type { AgentMode } from "@/lib/agent-modes";

export function TopBar({
  title,
  canExport,
  onExportChat,
  onNewChat,
  onOpenSidebar,
  sidebarOpen,
  desktopCollapsed = false,
  onToggleDesktopSidebar,
  onOpenSettings,
  onOpenModels,
  mode = "chat",
}: {
  readonly title?: string;
  readonly canExport: boolean;
  readonly onExportChat: () => void;
  readonly onNewChat: () => void;
  readonly onOpenSidebar: () => void;
  readonly sidebarOpen: boolean;
  readonly desktopCollapsed?: boolean;
  readonly onToggleDesktopSidebar?: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
  readonly mode?: AgentMode;
}) {
  const { t, settings, update } = useAppSettings();
  useEffect(() => {
    const openModelPicker = () => onOpenModels();
    window.addEventListener("tflash:open-model-picker", openModelPicker);
    return () => window.removeEventListener("tflash:open-model-picker", openModelPicker);
  }, [onOpenModels]);
  const nextTheme = settings.theme === "dark" ? "light" : "dark";
  const modeLabel = t(mode === "coder" ? "modeCoder" : mode === "research" ? "modeResearch" : "modeChat");

  return (
    <header className="tf-topbar tf-safe-x relative z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 text-foreground sm:gap-3 sm:px-5">
      <button
        aria-label={t("openMenu")}
        aria-controls="conversation-sidebar"
        aria-expanded={sidebarOpen}
        className="-ml-1 flex size-11 min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        onClick={onOpenSidebar}
        type="button"
      >
        <MenuIcon className="size-4" />
      </button>

      {onToggleDesktopSidebar ? (
        <button
          aria-controls="conversation-sidebar"
          aria-expanded={!desktopCollapsed}
          aria-label={t(desktopCollapsed ? "showSidebar" : "hideSidebar")}
          className="-ml-1 hidden size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
          onClick={onToggleDesktopSidebar}
          title={`${t(desktopCollapsed ? "showSidebar" : "hideSidebar")} (⌘B)`}
          type="button"
        >
          {desktopCollapsed ? <PanelLeftOpenIcon className="size-4" /> : <PanelLeftCloseIcon className="size-4" />}
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="shrink-0 rounded-md border bg-card px-2 py-1 text-[10px] font-semibold text-muted-foreground">{modeLabel}</span>
        {title ? <p className="truncate text-[13px] font-medium text-foreground">{title}</p> : null}
      </div>

      <button
        aria-label={`${t("theme")}: ${t(nextTheme)}`}
        className="tf-touch-target hidden min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
        onClick={() => update({ theme: nextTheme })}
        title={`${t("theme")}: ${t(nextTheme)}`}
        type="button"
      >
        {settings.theme === "dark" ? <SunIcon aria-hidden="true" className="size-4" /> : <MoonIcon aria-hidden="true" className="size-4" />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("moreActions")}
            className="tf-touch-target min-h-11 min-w-11 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem className="text-[13px]" onSelect={onOpenModels}>
            <SparklesIcon className="size-3.5" />
            {t("chooseModel")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-[13px]" onSelect={onNewChat}>
            <MessageSquarePlusIcon className="size-3.5" />
            {t("newChat")}
          </DropdownMenuItem>
          {canExport ? (
            <DropdownMenuItem className="text-[13px]" onSelect={onExportChat}>
              <DownloadIcon className="size-3.5" />
              {t("exportChat")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-[13px]" onSelect={onOpenSettings}>
            <Settings2Icon className="size-3.5" />
            {t("settings")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
