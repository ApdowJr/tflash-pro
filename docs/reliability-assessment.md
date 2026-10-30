# Agent reliability: confirmed behavior and remaining work

This assessment applies to the Eve 0.83.2 implementation in this repository;
local tests use mocks and do not establish live provider or sandbox behavior.

## Confirmed causes and boundaries

- `bash`, `web_fetch`, and every catalog MCP connection use `always()` at the
  execution policy. This intentionally asks for each call. Eve's `once()` is
  tool-wide and durable, and does not provide the immediate revocation and
  risk classification required for a user-controlled full-permissions mode.
  File tools and authored artifact/plan tools follow their existing policies.
- Supabase chat ownership is RLS-backed, but Vercel-account chat ownership is
  proof-based with a browser-local index. Neither is a shared, revocable,
  server-side permission store for both identities. Browser state and model
  context must not be used to authorize tools. Full permissions and reusable
  grants are **not implemented**; no UI claims they are active. Building them
  requires an authenticated shared store, server-side grant checks at each
  execution, a reviewed fail-closed policy for dynamic MCP tools and shell
  commands, and concurrent revocation tests. Project instructions are not an
  authorization boundary.
- Eve normally advances from a settled tool result to another model step within
  the same turn, and checkpoints completed workflow steps. A tool receipt from
  a task is not its settlement. Existing explicit approval or input waits hold
  the turn until answered. A completed *turn* does not verify that the user's
  larger task is complete. Plans are model-written reports, not an execution
  engine or proof of success; the latest plan can relate to an earlier turn.
- The step hook cancels before a model call would exceed the current 1–30
  per-turn allowance (default 12). Usage windows separately pause for explicit
  consent at the configured thresholds. The stream's `turn.cancelled` does not
  identify whether a user or the step hook caused the cancellation. The old UI
  tried to infer this from the *current* workspace limit, which may have changed
  after the turn. The UI now reports an unknown stop reason instead; the server
  logs a sanitized step-limit warning when the hook makes that decision.
- A disconnection is not a cancellation. Eve supports reconnecting the durable
  session, provided the deployment has a working persistent Workflow world.
  Interrupted workflow steps may rerun, so external effects can be ambiguous;
  check them before resuming. Automatic cross-turn replay based solely on the
  model-authored plan would risk repeating effects or spending past the user's
  intended budget. It is not implemented here. Eve's own workflow retries do
  not provide app-level exactly-once guarantees for all external integrations.

## Changes and limits

The activity projection now makes task settlement dominate replayed starts and
conflicting late successes; provisional plans do not replace settled plans.
The task card labels its counts as agent-reported and permits an explicit
review/continue even when the checklist says it is complete. The UI retains a
visible Stop button while drafting a follow-up, blocks a pending submission if
Stop occurs during chat-index persistence, and offers reconnect for a stream
error with an active turn. Transient stream errors trigger at most three
reconnection attempts for the same turn with exponential backoff and jitter;
HTTP Retry-After is respected up to 30 seconds, while authorization errors and
other permanent failures are not automatically retried. Reconnection uses Eve's
`resume()` and does not send a new turn or schedule a tool call. The retry budget
is browser-memory only; it does not establish background recovery after the tab
closes. Approval decisions are guarded against duplicate submissions and errors
remain retryable. Shell results with a nonzero exit are shown as failed; a
background process is shown as having an unknown outcome, not as successful.
Provisional artifact outputs do not produce download cards. These changes do not independently
verify final deliverables, establish exact task state, implement bounded
cross-turn continuation, or add durable permission management.

Production requires separately verified workflow storage, routes, sandbox and
provider connectivity as documented in the README. No migration or production
configuration change is included.
