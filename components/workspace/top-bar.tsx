"use client";

import {
  ChevronDownIcon,
  DownloadIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  MoreHorizontalIcon,
  Settings2Icon,
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
import { getProvider } from "@/lib/providers/catalog";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/settings/app-settings";
import type { AgentMode } from "@/lib/agent-modes";

export function TopBar({
  title,
  canExport,
  onExportChat,
  onNewChat,
  onOpenSidebar,
  sidebarOpen,
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
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
  readonly mode?: AgentMode;
}) {
  const { t, settings, update, selection, isConnected, modelsFor } = useAppSettings();
  const provider = getProvider(selection.providerId);
  const modelName = modelsFor(selection.providerId).find((model) => model.id === selection.modelId)?.name ?? selection.modelId;
  const connected = isConnected(selection.providerId);
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

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="shrink-0 rounded-md border bg-card px-2 py-1 text-[10px] font-semibold text-muted-foreground">{modeLabel}</span>
        {title ? <p className="truncate text-[13px] font-medium text-foreground">{title}</p> : null}
      </div>

      <button
        aria-label={`${t("chooseModel")}: ${modelName}${provider ? ` · ${provider.name}` : ""}`}
        className="group flex h-11 min-h-11 min-w-0 max-w-[48vw] shrink items-center gap-2 rounded-lg border bg-card px-2.5 text-[12px] transition-colors hover:border-foreground/20 hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[20rem] sm:px-3"
        onClick={onOpenModels}
        title={t("modelPickerHint")}
        type="button"
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
        <span className="min-w-0 truncate font-medium text-foreground">{modelName}</span>
        {provider ? <span className="hidden truncate text-muted-foreground md:inline">{provider.name}</span> : null}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

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
