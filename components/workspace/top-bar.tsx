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

export function TopBar({
  title,
  canExport,
  onExportChat,
  onNewChat,
  onOpenSidebar,
  sidebarOpen,
  onOpenSettings,
  onOpenModels,
}: {
  readonly title?: string;
  readonly canExport: boolean;
  readonly onExportChat: () => void;
  readonly onNewChat: () => void;
  readonly onOpenSidebar: () => void;
  readonly sidebarOpen: boolean;
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
}) {
  const { t, settings, update, selection, isConnected, modelsFor } = useAppSettings();
  const provider = getProvider(selection.providerId);
  const modelName = modelsFor(selection.providerId).find((model) => model.id === selection.modelId)?.name ?? selection.modelId;
  const connected = isConnected(selection.providerId);
  const nextTheme = settings.theme === "dark" ? "light" : "dark";

  return (
    <header className="tf-topbar tf-safe-x relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-background/80 px-3 text-foreground backdrop-blur-xl sm:gap-3 sm:px-5">
      <button
        aria-label={t("openMenu")}
        aria-controls="conversation-sidebar"
        aria-expanded={sidebarOpen}
        className="-ml-1 flex size-11 min-h-11 min-w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 focus-visible:ring-offset-2 lg:hidden"
        onClick={onOpenSidebar}
        type="button"
      >
        <MenuIcon className="size-4" />
      </button>

      <button
        aria-label={`${t("chooseModel")}: ${modelName}${provider ? ` · ${provider.name}` : ""}`}
        className="group flex h-11 min-h-11 min-w-0 max-w-[58vw] shrink items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.045] px-3 text-[12px] transition-colors hover:border-violet-300/25 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 focus-visible:ring-offset-2 sm:max-w-[22rem]"
        onClick={onOpenModels}
        title={t("modelPickerHint")}
        type="button"
      >
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", connected ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" : "bg-white/30")} />
        <span className="min-w-0 truncate font-medium text-foreground">{modelName}</span>
        {provider ? <span className="hidden truncate text-muted-foreground sm:inline">{provider.name}</span> : null}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-px" />
      </button>

      <div className="min-w-0 flex-1">
        {title ? <p className="truncate text-[13px] font-medium text-foreground/80">{title}</p> : null}
      </div>

      <button
        aria-label={`${t("theme")}: ${t(nextTheme)}`}
        className="tf-touch-target flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 focus-visible:ring-offset-2"
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
            className="tf-touch-target min-h-11 min-w-11 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 focus-visible:ring-offset-2"
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
