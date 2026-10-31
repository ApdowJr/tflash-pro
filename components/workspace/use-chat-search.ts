"use client";

import { useEffect, useMemo, useState } from "react";
import { waitWithAbort } from "@/lib/abortable";
import { searchChats } from "@/lib/chat-history";
import { MAX_MESSAGE_QUERY_LENGTH, MIN_MESSAGE_QUERY_LENGTH, type SearchSnippet } from "@/lib/chat-search";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership-wire";
import type { ChatRecord } from "@/components/settings/app-settings";

const DEBOUNCE_MS = 350;
const CONCURRENCY = 3;

type SearchState = {
  readonly key: string;
  readonly completed: number;
  readonly failed: number;
  readonly matches: Readonly<Record<string, SearchSnippet>>;
};

type Candidate = { readonly id: string; readonly proof?: string };

function validSnippet(value: unknown): value is SearchSnippet {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.before === "string" && item.before.length <= 65 &&
    typeof item.match === "string" && item.match.length > 0 && item.match.length <= MAX_MESSAGE_QUERY_LENGTH * 2 &&
    typeof item.after === "string" && item.after.length <= 65;
}

/** Search only chats not already matched by title. Requests are debounced,
 * concurrency-limited, account-scoped, and discarded as soon as inputs change. */
export function useChatSearch({
  query, chats, proofs, accountId, accountKind, hydrated,
}: {
  readonly query: string;
  readonly chats: readonly ChatRecord[];
  readonly proofs: Readonly<Record<string, string>>;
  readonly accountId: string;
  readonly accountKind: "supabase" | "vercel";
  readonly hydrated: boolean;
}) {
  const needle = query.trim();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>();
  const titleMatches = useMemo(() => searchChats(chats, needle), [chats, needle]);
  const candidates = useMemo<readonly Candidate[]>(() => {
    if (!hydrated || needle.length < MIN_MESSAGE_QUERY_LENGTH || needle.length > MAX_MESSAGE_QUERY_LENGTH) return [];
    const titleIds = new Set(titleMatches.map((chat) => chat.id));
    return chats.filter((chat) => !titleIds.has(chat.id)).map((chat) => ({ id: chat.id, proof: proofs[chat.id] }));
  }, [hydrated, needle, chats, titleMatches, proofs]);
  // Include revisions, proof and account in the key, so stale work is never
  // shown during the render before an effect has had a chance to clean up.
  const key = JSON.stringify([accountKind, accountId, needle, retry,
    chats.map(({ id, title, updatedAt }) => [id, title, updatedAt, proofs[id] ?? ""])]);
  const enabled = needle.length >= MIN_MESSAGE_QUERY_LENGTH && needle.length <= MAX_MESSAGE_QUERY_LENGTH && hydrated;

  useEffect(() => {
    if (!enabled || !candidates.length) return;
    const controller = new AbortController();
    let current = true;
    let next = 0;
    setState({ key, completed: 0, failed: 0, matches: {} });
    const timer = window.setTimeout(() => {
      async function worker() {
        while (current) {
          const candidate = candidates[next++];
          if (!candidate) return;
          let snippet: SearchSnippet | undefined;
          let failed = false;
          const requestController = new AbortController();
          const abortRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", abortRequest, { once: true });
          const timeout = window.setTimeout(abortRequest, 16_000);
          try {
            if (accountKind === "vercel" && !candidate.proof) throw new Error("Missing ownership proof");
            const headers = new Headers({ "content-type": "application/json" });
            if (accountKind === "vercel" && candidate.proof) headers.set(OWNER_PROOF_HEADER, candidate.proof);
            const pending = fetch(`/api/chats/${encodeURIComponent(candidate.id)}/search`, {
              method: "POST", headers, body: JSON.stringify({ query: needle }), cache: "no-store", signal: requestController.signal,
            });
            void pending.then((response) => {
              if (requestController.signal.aborted && response.body) void response.body.cancel().catch(() => {});
            }, () => {});
            const response = await waitWithAbort(pending, requestController.signal);
            if (!response.ok) throw new Error("Search unavailable");
            const body: unknown = await waitWithAbort(response.json(), requestController.signal);
            if (!body || typeof body !== "object") throw new Error("Invalid result");
            const result = body as Record<string, unknown>;
            if (result.status === "matched" && validSnippet(result.snippet)) snippet = result.snippet;
            else if (result.status !== "no-match") failed = true;
          } catch { failed = true; }
          finally {
            window.clearTimeout(timeout);
            controller.signal.removeEventListener("abort", abortRequest);
          }
          if (!current) return;
          setState((previous) => {
            if (!previous || previous.key !== key) return previous;
            return {
              ...previous,
              completed: previous.completed + 1,
              failed: previous.failed + (failed ? 1 : 0),
              matches: snippet ? { ...previous.matches, [candidate.id]: snippet } : previous.matches,
            };
          });
        }
      }
      for (let i = 0; i < Math.min(CONCURRENCY, candidates.length); i++) void worker();
    }, DEBOUNCE_MS);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [key, enabled, candidates, accountKind, needle]);

  const active = state?.key === key ? state : undefined;
  const completed = active?.completed ?? 0;
  const matches = active?.matches ?? {};
  const visibleChats = !needle ? chats : chats.filter((chat) =>
    titleMatches.some((match) => match.id === chat.id) || Object.hasOwn(matches, chat.id));
  return {
    chats: visibleChats,
    matches,
    total: candidates.length,
    completed,
    failed: active?.failed ?? 0,
    searching: enabled && candidates.length > completed,
    finished: enabled && candidates.length > 0 && completed === candidates.length,
    tooShort: needle.length > 0 && needle.length < MIN_MESSAGE_QUERY_LENGTH,
    retry: () => setRetry((value) => value + 1),
  };
}
