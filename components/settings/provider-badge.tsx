"use client";

import { CloudIcon, CpuIcon, LayersIcon, ServerIcon } from "lucide-react";
import type { ProviderInfo } from "@/lib/providers/catalog";
import { cn } from "@/lib/utils";

export function ProviderBadge({
  provider,
  className,
  size = "md",
}: {
  readonly provider: ProviderInfo;
  readonly className?: string;
  readonly size?: "sm" | "md" | "lg";
}) {
  const Icon =
    provider.group === "gateway"
      ? LayersIcon
      : provider.group === "local"
        ? provider.kind === "openai-compatible" && provider.requiresKey
          ? ServerIcon
          : CpuIcon
        : CloudIcon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white shadow-sm",
        size === "sm" && "size-6 text-[9px]",
        size === "md" && "size-8 text-[10px]",
        size === "lg" && "size-10 text-xs",
        className,
      )}
      style={{ backgroundColor: provider.accent }}
    >
      <Icon className={cn(size === "sm" ? "size-3" : size === "md" ? "size-4" : "size-5")} />
    </span>
  );
}

export function StatusDot({
  active,
  className,
}: {
  readonly active: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        active ? "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/15" : "bg-muted-foreground/40",
        className,
      )}
    />
  );
}
