import { cn } from "@/lib/utils";

/** A custom T / flash monogram, drawn as a single compact vector. */
export function BrandMark({ className, inverted = false }: { readonly className?: string; readonly inverted?: boolean }) {
  return (
    <svg aria-hidden="true" className={cn("shrink-0", className)} viewBox="0 0 44 44" fill="none">
      <rect width="44" height="44" rx="12" fill={inverted ? "#D2F377" : "#202620"} />
      <path d="M10 11.5h25l-2.8 5.2H23l-2.25 4.55h6.45L13 33.3l3.55-8.35H12.2l4.45-8.25H10v-5.2Z" fill={inverted ? "#202620" : "#D2F377"} />
    </svg>
  );
}

export function Brand({ className, inverted = false }: { readonly className?: string; readonly inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className="size-9" inverted={inverted} />
      <span className="tflash-wordmark">tflash<span className="tflash-wordmark-dot">.</span></span>
    </span>
  );
}
