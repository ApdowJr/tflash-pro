"use client";

import {
  ChevronDownIcon,
  DownloadIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  Settings2Icon,
} from "lucide-react";
import { FlashLockup } from "@/components/brand/logo";
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
  const { t, selection, isConnected, modelsFor } = useAppSettings();
  const provider = getProvider(selection.providerId);
  const modelName = modelsFor(selection.providerId).find((model) => model.id === selection.modelId)?.name ?? selection.modelId;
  const connected = isConnected(selection.providerId);

  return (
    <header className="tf-topbar tf-safe-x relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background/90 px-3 text-foreground backdrop-blur-xl sm:px-5">
      <button
        aria-label={t("openMenu")}
        aria-controls="conversation-sidebar"
        aria-expanded={sidebarOpen}
        className="-ml-1 flex size-11 min-h-11 min-w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
        onClick={onOpenSidebar}
        type="button"
      >
        <MenuIcon className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {title ? (
          <p className="min-w-0 truncate font-medium text-[13px] text-foreground">{title}</p>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <FlashLockup className="hidden sm:block" markClassName="size-6" wordmarkClassName="text-[14px]" />
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground md:inline">Workspace</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          aria-label={`${t("chooseModel")}: ${modelName}${provider ? ` · ${provider.name}` : ""}`}
          className="group flex h-11 min-h-11 min-w-0 max-w-[62vw] items-center gap-1.5 rounded-xl border border-border/70 bg-card px-2.5 text-[12px] transition-colors hover:border-[#c9953d]/40 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onOpenModels}
          title={t("modelPickerHint")}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              connected ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" : "bg-muted-foreground/40",
            )}
          />
          <span className="max-w-[7rem] truncate font-medium text-foreground sm:max-w-[13rem]">{modelName}</span>
          {provider ? <span className="hidden truncate text-muted-foreground sm:inline">{provider.name}</span> : null}
          <ChevronDownIcon className="size-3 shrink-0 text-white/65 transition-transform group-hover:translate-y-px" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("moreActions")}
              className="tf-touch-target min-h-11 min-w-11 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      </div>
    </header>
  );
}

