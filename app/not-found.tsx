import Link from "next/link";
import type { Metadata } from "next";
import { ErrorState } from "@/components/app/error-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center bg-background">
      <ErrorState
        eyebrow="404 · Boggan lama helin"
        title="This page does not exist"
        description="The link may be old, or the conversation may have been removed. Your other conversations are still in the sidebar."
        actions={(
          <Button asChild type="button">
            <Link href="/">Start a new chat · Bilow wada hadal cusub</Link>
          </Button>
        )}
      />
    </main>
  );
}
