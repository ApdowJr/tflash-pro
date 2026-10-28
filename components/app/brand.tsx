import { FlashMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { readonly className?: string; readonly inverted?: boolean }) {
  return <FlashMark className={cn("shrink-0", className)} />;
}

export function Brand({ className, inverted = false }: { readonly className?: string; readonly inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className="size-9" inverted={inverted} />
      <span className="text-lg font-semibold tracking-tight">Tflash</span>
    </span>
  );
}
