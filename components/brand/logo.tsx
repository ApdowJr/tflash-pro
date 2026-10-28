import { cn } from "@/lib/utils";

/**
 * T Flash mark.
 *
 * A capital T whose stem is drawn as a lightning bolt: the bar says the
 * letter, the bolt says what the product is for. Two flat colors, no
 * gradients, no glow — it stays legible at favicon size.
 *
 * The tile and bolt colors come from CSS variables so the mark keeps its
 * contrast on both the light paper and the dark charcoal surfaces.
 */
export function FlashMark({
  className,
  mono = false,
  title,
}: {
  readonly className?: string;
  /** Use the theme foreground/background instead of the brand amber. */
  readonly mono?: boolean;
  readonly title?: string;
}) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("block", className)}
      role={title ? "img" : undefined}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        fill={mono ? "currentColor" : "var(--brand-tile)"}
        height="32"
        rx="8.5"
        width="32"
      />
      <rect
        fill={mono ? "var(--background)" : "var(--brand-bolt)"}
        height="3.9"
        rx="1.95"
        width="19.2"
        x="6.4"
        y="7.6"
      />
      <path
        d="M20.5 11.5 12.2 20.1h3.7l-2.2 4.7 7.6-8.4h-3.7l2.9-4.9Z"
        fill={mono ? "var(--background)" : "var(--brand-bolt)"}
      />
    </svg>
  );
}

/** Logo tile plus the wordmark, used in the sidebar and on the sign-in screen. */
export function FlashLockup({
  className,
  markClassName,
  wordmarkClassName,
}: {
  readonly className?: string;
  readonly markClassName?: string;
  readonly wordmarkClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <FlashMark className={cn("size-7", markClassName)} />
      <span
        className={cn(
          "font-semibold text-[15px] tracking-[-0.01em] text-foreground",
          wordmarkClassName,
        )}
      >
        T Flash
      </span>
    </span>
  );
}
