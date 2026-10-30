# Agent reliability: confirmed behavior and remaining work

This assessment applies to the Eve 0.83.2 implementation in this repository;
local tests use mocks and do not establish live provider or sandbox behavior.

## Confirmed causes and boundaries

- Shell and catalog MCP tools retain per-call approval. An owner can grant repeated reads of one exact HTTPS homepage for one hour. The server checks the grant at the Eve gate and before the request. Redirects, paths and queries are excluded; public DNS answers are pinned to the TLS socket. Already-started requests cannot be recalled. This is not Full Permissions.
- The service-only Supabase tables namespace grants and tasks by identity type, owner and session. Both authentication modes use this store. Missing configuration fails closed. Setup requires the included migrations and server-only `TFLASH_PERMISSIONS_SERVICE_ROLE_KEY` and `TFLASH_PERMISSIONS_SUPABASE_URL` on Next and Eve; no migration or configuration is applied here.
- One user-defined objective and file SHA-256 criterion may be persisted. Verification reads sandbox bytes and records a point-in-time result using revision/state compare-and-set. Reverification can invalidate a previous match; every settlement changes the revision. Edits and tracking cancellation require the last observed revision, so stale tabs must refresh. A digest match does not verify the overall task; automatic cross-turn scheduling remains disabled.
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
error with an active turn. A disconnected Stop targets the observed turn using Eve's fixed-session cancel API, and then reconnects to observe its boundary; acceptance is not proof of cancellation. Transient stream errors trigger at most three
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
cross-turn continuation, or provide general-purpose durable permission management.

Production requires separately verified workflow storage, routes, sandbox and
provider connectivity as documented in the README. Migration files are included, but no production migration or configuration change was applied.

## Remaining security and recovery caveats

- Grant and revoke mutations now use per-origin revision checks; revoked/expired rows remain as tombstones so stale tabs cannot recreate a permission. Refresh after a conflict. This relies on the follow-up revision migration being applied to the same service store. A revoke cannot recall an already-started request, and individually approved fetches use their original policy. Permission snapshots fail if a conversation has over 1,000 distinct stored origins or the backend truncates results, but the independent revoke-all endpoint can still revoke existing homepage grants. Its session epoch is advanced under a database row lock shared with grant changes, so older pending mutations fail. Do not delete tombstones or epochs while stale clients or requests can still exist. The Next API and service store must both be reachable for revocation; if the request fails or its response is lost, revocation is unconfirmed and a grant may remain valid until its one-hour expiry. Already-started fetches cannot be recalled. All Next and Eve instances must be upgraded before relying on the epoch protocol; old application versions can bypass it.
- An explicit continuation is a new model turn, not a durable execution ledger; the user must inspect ambiguous effects. Eve workflow steps can retry, and external systems may not expose idempotency keys or status. Eve 0.83.2's MCP provided-argument callback can receive a replay-stable callId for the same tool call, but that is not a cross-turn operation ID or evidence that a remote MCP server honors a key. The current generic connection wrapper injects no idempotency key and exposes no integration-specific reconciliation contract. Support for particular remote operations is unverified. Without integration-specific reconciliation and a durable attempt ledger, safely automating cross-turn continuation is not established; no uncertain action is automatically resubmitted by this application. Manual continuation requires a review acknowledgement, not a claim that side effects have been reconciled.
- The optional service store uses a broad service-role key. Restrict distribution, rotate it through the deployment secret manager, and validate project identity and permissions before release. Hosted Supabase, the Eve workflow world, sandbox and actual providers have not been exercised by the isolated SQL/mocked tests.
- Changing the internal task and permissions mutation payloads is incompatible with a pre-update open tab. Reload tabs on release. A conflict preserves the form draft and requires refresh. Tracking cancellation and stopping an Eve turn are separate operations.

## Verification boundary

The emergency-revocation migration and function ordering are tested in isolated PGlite. A local HTTP fixture exercises the real Supabase JavaScript client against PGlite-backed RPCs, including a list-only failure, but it is not hosted Supabase/PostgREST. The connected Tflash project has only its default branch; no isolated hosted database was identified, and this work does not apply migrations remotely or deploy an application. Provider, Eve Workflow-world, production sandbox and actual external effect/idempotency behavior remain unverified.

## Isolated hosted validation plan (approval required)

Do not use the existing Tflash production/default project or its credentials.
Before creating a separate hosted project, obtain the owner's explicit approval,
confirm the selected organization, plan, quotas and any possible charges, and
agree on a spending limit and cleanup. No hosted resource has been created by
this work. Local PGlite tests remain the only migration testing authorized at
present; applying migrations to any hosted project requires separate approval.

Once authorized, provision a disposable, clearly named nonproduction project,
check its project reference against an explicit allowlist before each write,
and use synthetic users and data only. Keep service-role credentials exclusively
in the test process's secret store; never place them in browser bundles, Git,
logs or chat. Do not point an existing production or shared preview at it. An
isolated Next/Eve test environment with its own workflow storage and sandbox is
also required; otherwise the project tests database behavior only.

After separate approval for the hosted migration application, reconcile the
migration history and apply the three permission/task migrations to that project
only. Validate real PostgREST RPC privileges and error shapes, session ownership,
concurrent transactions and grant/revoke/epoch races, expiry, missing service
credentials, and coherent Next/Eve rollout. Exercise actual Eve fetch execution,
DNS and redirects, interruption/cancellation and sandbox verification with safe
local test endpoints. Test integrations only with disposable provider accounts
and explicitly authorized operations; never use production data or replay an
uncertain external action. Record evidence, resource cost and cleanup, then
remove test resources only after owner authorization. These steps are a plan,
not evidence that hosted checks or provider operations have succeeded.

## Additional local checks

MCP's public connection API exposes an approval policy but no neutral execution
wrapper for rechecking a revocable grant immediately before a generic remote
call. Its `providedArguments` changes all tool inputs and schemas; remote names
and read-only/idempotency hints cannot establish safety. Shell commands have the
same classification problem. Both therefore continue to require per-call
approval. Local tests call the real Eve approval policies for every registered
MCP connection and shell, including malicious-looking hints; these are policy
unit tests, not live MCP execution or proof that a provider is safe.

A stop request now suppresses scheduled stream reconnects until the cancellation
request returns. Once accepted, it reattaches without sending a turn, but keeps
follow-up submissions blocked until the observed turn has a terminal event or
projection. If confirmation cannot be obtained, manual reconnect remains
available; acceptance still cannot roll back an external effect. Reported cost
is hidden when a checkpoint or later step omits cost, rather than presenting a
known partial sum as a complete total. Provider usage remains advisory, not a
bill or an enforced spending cap.

The homepage grant check now has a five-second service-store deadline and
propagates Eve cancellation to the Supabase request. At the approval gate, a
timeout requires individual approval; before a grant-authorized socket it fails
closed. Late results cannot authorize a request after cancellation. Local tests
cover the real Supabase client against a deliberately stalled local HTTP server,
plus the approval and pre-socket paths; they do not prove hosted latency or
cancellation behavior. Already-started network requests cannot be recalled.
See [the separate hosted validation cost plan](hosted-validation-plan.md) for the
proposed $0 configuration and required prior approvals.
