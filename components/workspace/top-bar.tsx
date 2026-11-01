"use client";

import {
  ChevronDownIcon,
  DownloadIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  Settings2Icon,
  SparklesIcon,
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
    <header className="tf-topbar tf-safe-x flex h-16 shrink-0 items-center gap-2 border-b border-[#f3cf8a]/15 bg-[radial-gradient(circle_at_top,_rgba(243,189,86,0.12),transparent_30%),linear-gradient(180deg,rgba(17,15,14,0.92),rgba(22,20,18,0.96))] px-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:px-4">
      <button
        aria-label={t("openMenu")}
        aria-controls="conversation-sidebar"
        aria-expanded={sidebarOpen}
        className="-ml-1 flex size-11 min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3bd56]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#120f0d] lg:hidden"
        onClick={onOpenSidebar}
        type="button"
      >
        <MenuIcon className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="hidden items-center gap-2 rounded-full border border-[#f3bd56]/25 bg-[#f3bd56]/8 px-2.5 py-1.5 text-[11px] font-medium text-[#f7d38c] md:flex">
          <SparklesIcon className="size-3.5" />
          <span>Live</span>
        </div>
        {title ? (
          <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/4 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <p className="truncate font-medium text-[13px] text-white">{title}</p>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <FlashLockup className="hidden sm:block" markClassName="size-6" wordmarkClassName="text-[14px]" />
            <span className="hidden text-[11px] font-medium uppercase tracking-[0.14em] text-white/70 md:inline">Workspace</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          aria-label={`${t("chooseModel")}: ${modelName}${provider ? ` · ${provider.name}` : ""}`}
          className="group flex h-11 min-h-11 min-w-0 max-w-[62vw] items-center gap-1.5 rounded-full border border-white/10 bg-white/5 pr-2 pl-2.5 text-[12px] shadow-[0_12px_30px_-18px_rgba(0,0,0,0.9)] transition-colors hover:border-[#f3bd56]/30 hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3bd56]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#120f0d]"
          onClick={onOpenModels}
          title={t("modelPickerHint")}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              connected ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.16)]" : "bg-white/30",
            )}
          />
          <span className="max-w-[7rem] truncate font-medium text-white sm:max-w-[13rem]">{modelName}</span>
          {provider ? <span className="hidden truncate text-white/65 sm:inline">{provider.name}</span> : null}
          <ChevronDownIcon className="size-3 shrink-0 text-white/65 transition-transform group-hover:translate-y-px" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("moreActions")}
              className="tf-touch-target min-h-11 min-w-11 text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3bd56]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#120f0d]"
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

