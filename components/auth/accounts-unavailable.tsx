"use client";

import { CheckIcon, CopyIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "tflash:accounts-notice";

/**
 * Shown when the deployment has no auth credentials.
 *
 * Accounts are optional: the workspace still runs on the visitor's own provider
 * key. This says so once, names the variables the operator has to set, and stays
 * out of the way after that.
 */
export function AccountsUnavailable({ missing }: { readonly missing: readonly string[] }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode: the notice simply returns next visit.
    }
  };

  const copy = () => {
    void navigator.clipboard.writeText(missing.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <aside
      className="tf-rise fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur sm:left-3 sm:right-auto sm:mx-0"
      role="status"
    >
      <div className="flex items-start gap-2">
        <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-[12px] text-foreground">Accounts are off on this deployment</p>
          <p className="text-pretty text-[11px] text-muted-foreground leading-snug">
            Sign-in needs credentials the server does not have yet. Everything else works with your
            own provider key — add one in Settings → Providers.
          </p>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {missing.map((name) => (
              <code
                className="rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                key={name}
              >
                {name}
              </code>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="Copy missing variables"
            className="size-6 text-muted-foreground"
            onClick={copy}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </Button>
          <Button
            aria-label="Dismiss"
            className="size-6 text-muted-foreground"
            onClick={dismiss}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
