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

/**
 * A thin, quiet bar: where you are on the left, which model is answering on
 * the right. Nothing else competes with the conversation.
 */
export function TopBar({
  title,
  canExport,
  onExportChat,
  onNewChat,
  onOpenSidebar,
  onOpenSettings,
  onOpenModels,
}: {
  readonly title?: string;
  readonly canExport: boolean;
  readonly onExportChat: () => void;
  readonly onNewChat: () => void;
  readonly onOpenSidebar: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
}) {
  const { t, selection, isConnected } = useAppSettings();
  const provider = getProvider(selection.providerId);
  const connected = isConnected(selection.providerId);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
      <button
        aria-label={t("openMenu")}
        className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
        onClick={onOpenSidebar}
        type="button"
      >
        <MenuIcon className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {title ? (
          <p className="truncate font-medium text-[13px] text-foreground">{title}</p>
        ) : (
          <FlashLockup className="lg:hidden" markClassName="size-6" wordmarkClassName="text-[14px]" />
        )}
      </div>

      <button
        className="group flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-border/80 bg-card/70 pr-2 pl-2.5 text-[12px] transition-colors hover:border-border hover:bg-card"
        onClick={onOpenModels}
        title={t("modelPickerHint")}
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            connected ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
        <span className="max-w-[7.5rem] truncate font-medium text-foreground sm:max-w-[13rem]">
          {selection.modelId}
        </span>
        {provider ? (
          <span className="hidden truncate text-muted-foreground sm:inline">{provider.name}</span>
        ) : null}
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-px" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("moreActions")}
            className="text-muted-foreground"
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
