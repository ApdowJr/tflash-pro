"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { FlashLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Sign-in screen: the mark, one sentence, one button. No marketing copy that
 * explains the product back to the person who already opened it.
 */
export function SignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function signIn() {
    setPending(true);
    setError(undefined);
    try {
      const result = await authClient.signIn.social({
        callbackURL: "/",
        provider: "vercel",
      });
      if (!result.error) return;
      setPending(false);
      setError("Sign-in failed. Try again.");
    } catch {
      setPending(false);
      setError("Sign-in failed. Try again.");
    }
  }

  return (
    <main className="tf-safe-x tf-safe-bottom flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground sm:px-6">
      <div className="tf-rise flex w-full max-w-sm flex-col gap-7">
        <FlashLockup markClassName="size-9" wordmarkClassName="text-lg" />
        <div className="space-y-2">
          <h1 className="text-balance font-semibold text-2xl leading-tight tracking-[-0.02em]">
            Sign in to continue
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your chats and provider connections stay attached to your account.
          </p>
        </div>
        <div className="space-y-3">
          <Button
            className="h-11 w-full gap-2 text-sm sm:h-10"
            disabled={pending}
            onClick={signIn}
            type="button"
          >
            {pending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <svg aria-hidden="true" className="size-3 fill-current" viewBox="0 0 24 20">
                <path d="M12 0 24 20H0L12 0Z" />
              </svg>
            )}
            {pending ? "Redirecting…" : "Continue with Vercel"}
          </Button>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
          One workspace for OpenRouter, OpenAI, Anthropic, Gemini, Groq and local models.
        </p>
      </div>
    </main>
  );
}
