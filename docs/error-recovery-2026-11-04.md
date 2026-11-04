# Error recovery: a failed panel no longer takes the screen

Date: 2026-11-04

## Symptom

A signed-in reader could land on the route error screen:

> Something broke · Khalad ayaa dhacay — This screen could not load
> The page failed while rendering…

with no error digest. An absent digest means the failure came from the client
render, not from a server component: the page had already been delivered and
React then threw while rendering the authenticated shell.

The Coder and Deep Research workspaces shipped as the app's first code-split
panels (`React.lazy` + `Suspense`). A dynamic import rejects whenever its chunk
cannot be fetched — a freshly promoted deployment replacing hashed files while a
tab is open, a dropped connection, a proxy/CDN error, or an extension blocking
the request. `React.lazy` converts that rejection into a render error, and the
nearest boundary was the **route** boundary, so one unloadable ~400-line panel
replaced the conversation, the sidebar and the composer.

Worse, React caches a rejected import for the lifetime of the module. The error
screen's "Try again" re-rendered the same `lazy()` component, replayed the cached
rejection, and failed again — only a full page reload recovered.

## Fix

- **Panel-scoped recovery** (`components/app/lazy-panel.tsx`). `LazyPanel` wraps
  a split panel in a small error boundary with `Suspense`. A chunk failure now
  renders inside that panel's column: a localized explanation, an in-place retry
  that builds a **new** `lazy()` component (so a new import attempt is made), and
  a reload action for the case where the module map holds the rejection. The
  transcript, composer, sidebar and approvals keep working.
- **Route boundary** (`app/error.tsx`). Failures that do reach the page boundary
  retry once automatically (a transient failure usually clears), then show an
  actionable screen with a reload button, the digest when the server provided
  one, and a full `error.name`/`message`/`stack` log for support. The automatic
  attempt is per boundary instance, so a deterministic failure cannot loop.
- **Address-bar updates** (`components/chat/agent-chat.tsx`). The history writes
  used `History.prototype.replaceState.call(window.history, …)`; they now go
  through one guarded `replaceRoute()` helper. A browser that blocks the History
  API can no longer throw out of sending a turn or switching a mode.

Deliberately unchanged: storage failures still surface as explicit errors rather
than silent success. A failed workspace or chat-proof write must not look saved,
so those paths keep throwing into the callers that already report it.

## Verification

- `pnpm test`: 481/481 passing, including five new tests:
  - a split panel renders its fallback and then the panel;
  - an unloadable panel fails inside its column, keeps the surrounding screen,
    logs the error and recovers on retry;
  - the route error screen retries exactly once and exposes reload/retry;
  - the real chat shell keeps the composer enabled when the Coder workspace
    module throws while evaluating (`tests/chat-panel-recovery.test.mjs`);
  - the new copy exists in both English and Somali.
- `pnpm typecheck`: clean.
- `next build`: compiles, and the production server still streams the Coder and
  Research panels behind their `Suspense` fallbacks.
- Manual: `/`, `/?mode=coder`, `/?mode=research` and `/s/<unknown>` render
  without reaching the error boundary.

## Limits

The exact failure in the reporter's browser was not observed directly: the
production deployment is healthy, and every server-rendered route, the client
tree under jsdom and the production build reproduce no error. The change
addresses the failure class that this release introduced (an unloadable panel
chunk) and makes every remaining whole-page failure recoverable instead of
terminal. If the screen still appears after this change, the new log line
(`[tflash] route error <digest> <name> <message> <stack>`) identifies the exact
component and error.
