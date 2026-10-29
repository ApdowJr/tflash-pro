import type { ReactNode } from "react";
import { FlashMark } from "@/components/brand/logo";

/**
 * The one surface for "something did not work".
 *
 * Deliberately server-safe (no hooks, no context) so route-level
 * `error.tsx`, `global-error.tsx`, `not-found.tsx` and in-app empty states can
 * all use it. Copy is bilingual on purpose: the product ships for Somali and
 * English readers, and an error is the worst moment to guess a language from a
 * cookie that may itself be the thing that failed.
 */
export function ErrorState({
  eyebrow,
  title,
  description,
  detail,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  /** Short technical hint (an error digest or request id). Never a stack trace. */
  readonly detail?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-start gap-5 px-6 py-16"
      role="alert"
    >
      <FlashMark className="size-9" title="Tflash" />
      <div className="space-y-2">
        <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
          {eyebrow}
        </p>
        <h1 className="text-balance font-semibold text-[24px] text-foreground leading-tight tracking-[-0.01em]">
          {title}
        </h1>
        <p className="text-pretty text-[13.5px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
      {detail ? (
        <p className="rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          {detail}
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
