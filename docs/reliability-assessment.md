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
closes. Approval decisions have a durable browser-side uncertainty review described
below; a lost response is not automatically retried. Shell results with a nonzero exit are shown as failed; a
background process is shown as having an unknown outcome, not as successful.
Provisional artifact outputs do not produce download cards. These changes do not independently
verify final deliverables, establish exact task state, implement bounded
cross-turn continuation, or provide general-purpose durable permission management.

Production requires separately verified workflow storage, routes, sandbox and
provider connectivity as documented in the README. Migration files are included, but no production migration or configuration change was applied.

## Remaining security and recovery caveats

- Grant and revoke mutations now use per-origin revision checks; revoked/expired rows remain as tombstones so stale tabs cannot recreate a permission. Refresh after a conflict. This relies on the follow-up revision migration being applied to the same service store. A revoke cannot recall an already-started request, and individually approved fetches use their original policy. Permission snapshots fail if a conversation has over 1,000 distinct stored origins or the backend truncates results, but the independent revoke-all endpoint can still revoke existing homepage grants. Its session epoch is advanced under a database row lock shared with grant changes, so older pending mutations fail. Do not delete tombstones or epochs while stale clients or requests can still exist. The Next API and service store must both be reachable for revocation; if the request fails or its response is lost, revocation is unconfirmed and a grant may remain valid until its one-hour expiry. Already-started fetches cannot be recalled. All Next and Eve instances must be upgraded before relying on the epoch protocol; old application versions can bypass it.
- The older plan-card continuation is a new model turn outside the tracked-task attempt ledger; the user must inspect ambiguous effects. Eve workflow steps can retry, and external systems may not expose idempotency keys or status. Eve 0.83.2's MCP provided-argument callback can receive a replay-stable callId for the same tool call, but that is not a cross-turn operation ID or evidence that a remote MCP server honors a key. The current generic connection wrapper injects no idempotency key and exposes no integration-specific reconciliation contract. Support for particular remote operations is unverified. The manual attempt ledger does not provide integration-specific reconciliation, remote turn identity, or global execution fencing; safely automating cross-turn continuation is not established; no uncertain action is automatically resubmitted by this application. A durable unresolved hold keeps the attempt pending; an explicit revision-fenced release is a human acknowledgement, not a claim that side effects have been reconciled. A hold cannot recall a dispatch that already began. Migration 170 revokes the old review RPC from service_role; old Next instances fail closed for review until upgraded, and new instances require the new migration.
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
migration history and apply the six permission/task migrations to that project
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

Local follow-up bounds sandbox evidence verification to 20 seconds and observes
cancellation while waiting on task lookup, sandbox initialization and stream
reads. Late streams are cancelled best-effort; a timeout or cancellation before
settlement does not become a mismatch or match. A settlement already dispatched
to the database can still have an uncertain result and cannot be rolled back by
this change. Stream reconnect now recognizes case-insensitive and `Headers`
Retry-After values and rejects noncanonical/malformed dates instead of retrying
early. Turn and plan projections are memoized across unchanged Eve snapshots;
new transcript/turn snapshots invalidate them. See the separate
[bounded-continuation design](bounded-continuation-design.md) and
[preview-control investigation](preview-control-investigation.md). These are
not a scheduler, hosted proof or authorization to push/deploy.


## Call-bound homepage decisions and dispatch review

The local call-decision migration binds an automatic homepage decision to the
owner, session, tool call ID, exact origin, grant revision and epoch. Revoking
and regranting does not revive an old decision. The post-DNS check atomically
consumes the decision before the socket attempt; a lost database response or
failed request remains consumed and is not automatically replayed. The service
retains at most 2,000 decisions per conversation and requires per-call approval
after the limit; it must not evict old decisions while calls can replay. A GET
can have effects on a remote server; this is at-most-one grant-authorized
socket attempt, not proof of exactly-once external effects. Revocation cannot
recall a request whose consume check already succeeded. Old Eve deployments can
bypass the new protocol; coordinated rollout and separate migration approval
are prerequisites, not actions performed here. Local PGlite and fake DNS/TLS
fixtures do not establish real concurrent PostgreSQL or hosted behavior.

A browser-tab marker is written before message dispatch. If dispatch fails, Eve
reports an error, a stop races it, or the tab reloads with the marker, the UI
blocks a new message and directs the user to reconnect, inspect activity and
external services, and explicitly review before unlocking. Eve's `onError`
callback matters because its send promise can resolve after an error. This is
a practical recovery aid only: sessionStorage can be unavailable or cleared,
is tab-local, and is neither a remote idempotency key nor a cross-tab lock.
Unlocking does not prove reconciliation. The UI never automatically resends
an uncertain turn.


## Manual budgeted continuation (local implementation)

The tracked-task panel accepts 0–3 manually initiated turns. A service-only
SQL reservation atomically decrements the task's budget, changes its revision,
and stores an immutable attempt identity. A second transition checks the
current task revision and state and can be used only once. Cancellation or
replacement before that transition blocks dispatch. After the transition,
cancellation cannot recall an already-issued or about-to-be-issued browser
request. A response lost at either transition is never retried automatically.
The pending record survives tab reloads and task replacement and prevents a
second **budgeted** start until the owner supplies a review note. Reservation
advances the permission epoch under the web-decision lock, invalidating prior
calls and requiring individual homepage approval while the attempt is pending;
an already-consumed request cannot be recalled. The record does not
block normal chat, prove a turn ended or reconcile external effects. Notes are
service-only and owner-scoped; avoid secrets. The last 20 are shown. A 2,000
record cap fails closed rather than deleting old replay tombstones. The
transcript label is not a provider idempotency key. No automatic scheduling,
background operation or spend cap is implied.

The next migration is ordered after `20261030150000`. Both Next and Eve use
the same server-only service-role store, but the new manual dispatch route is
in Next and its parent turn is executed by Eve. Missing schema or credentials
make the new path unavailable, not automatically approved. Deploy mixed
versions only with explicit operational precautions: older tabs and instances
can still use ordinary chat, so the ledger is not a global execution fence.
No hosted migrations, credentials or production services were changed.

## Concurrent submission and browser recovery (Phase 3)

A send or steer can wait for chat-history persistence while another send is
still in flight. If that earlier send rejects or Eve reports a transport error,
a browser-memory uncertainty epoch now invalidates the waiting submission
before it reaches `send()`, even if the user subsequently reviews the warning.
An immediate ref guard also blocks a new submission before the UI rerenders.
The rejected submission's text remains in the composer or its recoverable
failed-draft list; this does not automatically replay either message. Healthy
explicit steering is still supported.

If the browser rejects a dispatch-marker write, the chat now displays a
persistent warning for that mounted session. Messaging remains available, but
an interrupted outcome may lose its warning on reload or tab close. This is
still a same-tab, best-effort aid, not a cross-tab lock, durable ledger, remote
idempotency guarantee, or proof of the actual effect. Permission decisions and
external-operation approval rules are unchanged. The regression tests exercise
mock Eve callbacks/rejections and browser storage failures, not a hosted Eve
runtime or actual external effects.

## Current-conversation usage and tool status

Settings → Workspace exposes a collapsed, on-demand model-usage summary for
the open conversation; it does not restore the removed Activity & usage panel
in the chat. It uses reported session checkpoints and later identifiable model
steps, avoids counting observed step replays twice, and displays a metric as
not reported when a required component is missing or conflicting. If an event
was not present in the local stream, the UI cannot independently detect all
missing or replayed work. Eve's cumulative checkpoints may include delegated
usage, but reported cost may omit unpriced model calls and excludes compaction,
tool and infrastructure charges. This is not an invoice, verified total or
spending cap.

Collapsed shell cards now label nonzero exit codes as failed and distinguish a
background or unrecognized outcome from success; partial results are shown as
running. This changes presentation only, not tool execution or approval rules.
Output-available for another tool remains a tool result, not proof that the
user's task or an external side effect completed. Local tests use synthetic
stream events and mocked tools; they do not establish hosted billing, actual
external effects or production runtime behavior.

## Chat search recovery

The sidebar now offers a keyboard-accessible clear-search control that returns
focus to the search field and cancels outstanding searches. Browser search
workers stop waiting at their timeout even when a fetch or JSON reader ignores
abort; incomplete chats remain marked as unavailable rather than reported as
no matches. The server similarly stops waiting for an uncooperative request
body, upstream fetch or stream read, releasing its per-instance search slot.
Late upstream responses are discarded and their bodies are cancelled when
possible. These are bounded waiting and UI recovery behaviors, not a guarantee
that a remote service immediately stops work after cancellation. Search still
only covers the currently indexed chats and its existing bounded text stream.
Local tests simulate stalled transports and streams; hosted behavior and visual
keyboard/mobile testing remain unverified.

## Workspace and history sync interruptions

Browser workspace and chat-history reads bound both network and JSON waits;
a timed-out operation can still complete on the server. A workspace write with
an unconfirmed response blocks queued writes in this mounted tab. An explicit
retry reads the account copy and requires a user choice before writing again,
even when copies appear equal, because the old request may still complete.
Existing compare-and-set checks remain in force; no UI choice recalls an
in-flight request. Account-scoped localStorage markers (containing identifiers but no synced content) survive reloads; cloud writes
fail closed if marker storage is unavailable. They are not a cross-tab lock,
and clearing browser storage removes them.
For Vercel history, an uncertain import retains browser data and requires an
explicit refresh instead of a focus- or reload-triggered replay; imports also
fail closed without marker storage. Verified import SQL remains
idempotent and tombstone-safe. New history requests identify the account and
login kind they expect, so a changed cookie cannot silently return another
account's history to that request. Legacy clients without the read headers
retain their old behavior, so a coordinated rollout is required. These checks
are exercised locally with stalled transports and mocked services, not hosted
Supabase or real simultaneous production transactions.

## Conversation history action recovery

Rename, removal and the activity update before a message now bound both the
response and JSON waits. A data-minimizing localStorage marker is written before
sending each action (account ID, chat ID and action type; no title, proof or
message). A lost response, server error or malformed success leaves a warning,
retains the local history and blocks later actions on that chat, including the
activity update that precedes message dispatch. Drafts remain available. A
known route validation/ownership/account rejection removes the marker without
claiming an action completed. Unavailable marker storage prevents dispatch.
The sidebar displays the pending chat ID and action, and requires a deliberate
checkbox and acknowledgement after review; acknowledgement does not repeat
an action or establish that it has finished. A timed-out server operation can
still commit later. Markers survive reload but can be cleared with browser
storage; they are not a cross-tab lock, server-side fence, or authoritative
reconciliation. Older clients do not send account-binding headers and are not
protected by this client guard. Actual Eve reset remains best effort, not proof
of erasure. The PATCH request body and the best-effort reset wait are bounded;
client deadlines cannot stop already-started server or database work. Local
mocked tests do not establish hosted Eve/Supabase behavior or real device UX.

## New-session creation interruptions

The browser records an account-scoped marker before starting session creation.
A lost response, timeout, malformed response, or storage failure after Eve
creation may leave an orphan or an already-created session. The marker survives
reload and blocks another automatic creation; it contains account identifiers,
not prompts, tokens or conversation content. The draft stays editable in the
current mounted page and is not sent. The user must inspect what they can and
explicitly acknowledge the risk before requesting another session. A session
with no first message can be absent from the visible history, so this is not an
authoritative lookup or proof that nothing was created. The acknowledgement
cannot cancel a request still running. Marker storage failure blocks creation;
clearing browser storage loses the warning. This is not a cross-tab/server lock
or idempotency key, and old clients lack this guard.

A positively identified preflight failure, authentication rejection, account
mismatch or rate-limit response is handled before Eve is called and can be
retried without an uncertainty review. The same storage error after Eve was
called is instead uncertain. New requests bind the expected login identity;
legacy clients without headers retain their old behavior. Both the browser and
Next server bound their Eve fetch/JSON waits even for an uncooperative
transport; the server also stops waiting on preflight and index insertion at the
same deadline. An already-started database operation can still finish. Timeouts do not roll back work, remove orphan workflows, establish
idempotency, or prove browser-to-Eve cancellation. Vercel owner proofs are
saved locally before a confirmed creation's marker is cleared. Local tests use
mock transports, not a hosted Eve world, real Supabase concurrency or devices.

## OAuth renewal uncertainty

A refresh token can rotate even when the browser or Next server loses the
provider's response. Automatic renewal now records an account- and
integration-scoped localStorage marker before dispatch and uses the browser Web
Locks API to avoid overlapping renewal attempts for that account/integration
within the same origin and browser profile. Without Web Locks or writable
recovery storage, automatic renewal is paused; existing saved credentials are
not deleted. Provider failures, timeouts, bad JSON and unconfirmed response
persistence leave a pending warning and do not trigger automatic retries. The
browser and server bound their waits; a timed-out provider request can still
finish. This is not a distributed lock, server-side idempotency, a proof of
revocation, or protection against old app versions, separate profiles, devices,
or direct API clients. New browser requests bind their expected principal;
legacy requests without headers retain their former compatibility.

On a confirmed response, the replacement sealed record is stored before a
settled marker is retained for the previous sealed ciphertext's SHA-256
fingerprint. That tombstone blocks automatic replay if another tab restores an
older settings copy; it does not reveal the plaintext token. A 2,000-marker
cap fails closed, and clearing browser storage loses the protection. After an
uncertain outcome, the user must inspect/revoke the previous provider grant,
disconnect and complete a new provider consent flow, then explicitly attest
review before automatic renewal is allowed for the different sealed grant.
This is a human attestation, not provider-verified reconciliation; the old
request might still complete. No renewal happens merely from acknowledging the
warning. If a provider supplies no access-token expiry after confirmed renewal,
the browser waits at least 12 hours before another automatic attempt. These
changes do not revoke grants or modify MCP tool approval/authorization rules.
Local tests use mocked OAuth endpoints and browser storage, not real provider
rotation behavior, hosted systems or multiple physical devices.

## Provider catalogs and integration status

Provider discovery uses a nine-second deadline for both network and body reads,
with an 8 MiB response ceiling, a 20,000-item scan limit and at most 400
normalized IDs; redirects are refused. Transport errors are not surfaced raw,
which avoids exposing a URL containing a provider key. An invalid response is a
failure. A valid empty/unusable model list may still indicate a reachable local
endpoint, but its built-in suggestions are explicitly unverified and are not
counted as live models. A model-list response alone does not establish that a
model will answer, that billing is configured, or that all capabilities work.
Forced provider saves report that the connection test failed and was not
verified. The gateway's existing special-case behavior is retained.

Browser status and model reads have a 12-second deadline and a 1 MiB ceiling;
provider test/connect responses have the same deadline and a 64 KiB ceiling.
The waits also stop if a transport or body ignores cancellation. Timeout cannot
undo an upstream request already started. Late or superseded catalog results
are scoped to their credential and account; model failures need an explicit
Refresh rather than an automatic retry loop. Integration status failures show a
manual retry while keeping locally saved grants visible. Configuration status
and stored tokens are not proof that an external integration is currently
reachable or authorized. Account headers bind new requests to the currently
authenticated principal but are not authentication; older clients without the
headers remain compatible. Provider connect/test are explicit requests and are
never automatically replayed on a timeout. These paths do not replace the OAuth
renewal uncertainty controls above. All tests use local mocks rather than real
provider endpoints, hosted services or physical devices.

## Document import and export interruptions

PDF/DOCX import and PDF/DOCX export use a 25-second browser deadline, including
response body consumption. JSON extraction responses are capped at 1 MiB and
binary exports at 16 MiB; binary MIME type is checked exactly. Server request
body reads are limited to eight seconds and retain their existing byte limits;
PDF/DOCX extraction runs in its isolated worker with its existing 12-second
processing limit. A deadline stops waiting and requests stream cancellation,
but does not guarantee already-started server work stopped. No operation is
retried automatically. After a failure the draft remains; users can choose to
retry the document or send without it.

While an import is pending, the composer blocks Send (including Enter and form
submission) so a draft cannot appear to include an extraction that has not
arrived. Successful extraction creates an explicitly untrusted text attachment;
it does not itself send a message. Pending results are discarded when the
composer unmounts or the account changes. Export results are also discarded if
the account, filename or content changes before completion. New document
requests bind the expected account before the server reads the request body;
this is not authentication, and old clients without headers remain compatible.
The browser cannot cancel a file already downloaded or prove a remote process
was terminated. Tests use local mocks and real local PDF/DOCX parsing, not
hosted services or physical devices.

## OAuth handoff after consent

After provider consent, the callback has already attempted a token exchange.
The browser now records an account-scoped recovery marker before reading the
short-lived handoff cookie and uses an origin-wide Web Lock for the shared cookie. Without
writable recovery storage or Web Locks, it does not consume the handoff. The
fetch and response body have a 12-second deadline and a 64 KiB ceiling. A lost
response, malformed body, interrupted read or failure to persist the sealed
record retains the marker; reload does not automatically read the handoff
again. The marker stores only the integration identifier, not a credential.
The sealed record is durably saved before the marker is removed and a success
notice is shown. A concurrent disconnect or changed credential prevents an old
handoff response from resurrecting or overwriting it.

Connections shows an explicit warning and blocks starting another OAuth flow
from that panel while a marker remains. The user must inspect the provider's
authorized apps and explicitly acknowledge review; this acknowledgment does
not revoke a grant, establish whether it exists, cancel an in-flight request or
retry anything. A timeout cannot guarantee the request has stopped. Recovery
markers are limited to 2,000 per account and clearing browser storage loses
them. Web Locks coordinate only same-origin tabs within one browser profile;
they are not server-side exactly-once semantics, and old clients, other devices
and direct requests are not fenced. OAuth callbacks themselves do not acquire
the browser lock: overlapping callbacks can replace the single handoff cookie,
and a delayed cookie-clearing response can clear a newer handoff. The result route checks expected account
headers and rejects cross-site requests before touching the cookie. New
handoffs also bind account kind; older cookies without this field retain their
prior owner-ID-only compatibility. A valid handoff belonging to another
principal is not cleared. Older clients without expected-account headers
remain supported. This change does not add a server-side ledger for OAuth code
exchange or establish provider-side revocation/reconciliation. Local tests use
mock providers and browser storage, not hosted OAuth services or devices.

## OAuth registration and code exchange interruptions

Dynamic OAuth client registration and token exchange each have a ten-second
server deadline covering both network and streaming response, with a 64 KiB
response limit; redirect forwarding remains disabled. A registration timeout,
malformed/oversized response or failure after dispatch is **not** proof that the
provider did not create a client. Likewise, a failed or lost exchange response
is **not** proof that a code was rejected or a grant was not issued. The server
never retries either call automatically. It returns distinct unconfirmed status
codes without provider error text or credentials in the redirect, and new
callback responses set `Referrer-Policy: no-referrer`. Account kind is included
in new OAuth state; legacy state without it remains owner-ID compatible.

When the browser receives an unconfirmed redirect, it records an integration-
scoped recovery warning and blocks another consent flow from Connections until
explicit review. If storage cannot be written, the warning query remains on the
URL so a reload does not erase the only notice. It contains no authorization
code, client secret or provider token. Reviewing is human acknowledgment, not
provider reconciliation or revocation. Web Locks coordinate review, not the
provider's callback. If the redirect itself is lost, or a client bypasses the
UI, the browser may never record the warning. There is no durable server-side
exchange/registration ledger: direct callback replays, reloads or concurrent
requests across instances cannot be guaranteed at-most-once. The provider may
complete a request after the timeout, and registrations may remain at the
provider. Users should check authorized apps and registered clients before
starting again. Do not infer exactly-once behavior from the cookie, timeout,
warning, or local tests. The tests use fake provider responses; hosted provider
behavior and device/network handling remain unverified.

## Permission and tracked-task control interruptions

Permission snapshots and tracked-task reads/writes have a 12-second browser
network and body deadline and bounded JSON (512 KiB and 128 KiB respectively).
Snapshots are validated before showing grants, epochs or task states; a bad
response is not displayed as an empty permission list or completed task.
Continuation ledger reads and responses also have a bounded body and their
existing eight-second deadline. New requests bind the expected account before
chat ownership is checked; clients without these optional headers retain their
previous behavior.

Before a permission grant/revoke or tracked-task save/cancel, the browser stores
an account- and session-scoped marker containing only the action and session
identifier. Unknown outcomes (including timeout, unparseable response or a
server error after a possible change) preserve the marker across reload and
block ordinary same-session changes until a user explicitly reviews and
acknowledges the warning. A validated success clears only its own marker.
Only an explicit `changeNotStarted` response from a known pre-dispatch
rejection or CAS conflict clears a marker without success; an unasserted 409 is
uncertain. A refresh is a read, not proof a delayed write has finished, and
acknowledgment does not cancel or reconcile an in-flight request. Draft form
values stay in the currently mounted panel on failure, not necessarily after a
reload. Markers are capped at 2,000 per scope/account, malformed markers block
conservatively, and storage failure pauses ordinary writes.

Emergency revoke-all remains available even if the list is unavailable, another
request is stuck, a marker exists, or marker storage fails. When storage fails,
an uncertain emergency request cannot be durably remembered across reload;
its success is shown only after the server confirms it. Revocation advances the
existing server epoch but cannot recall an already-running fetch. These markers
are browser breadcrumbs, not distributed locks or a server-side idempotency
ledger. Review is disabled while the current panel has a request in flight, but
another tab can acknowledge that marker while the request still runs; simultaneous
cross-tab starts can also race. Clearing browser storage, other profiles/devices,
old clients and direct API calls are outside their protection. Existing database revision/epoch checks
and task-continuation fences remain in place. No test here proves hosted
Supabase concurrency or behavior on actual devices.

### Continuation response and interruption handling

Continuation snapshots now require a complete, bounded shape, valid attempt
and review UUIDs, parseable timestamps, bounded notes and mutually consistent
pending/history entries on both the route and the browser. Invalid or partial
responses fail closed instead of presenting an empty ledger. Account, session
and ownership-proof changes hide the old panel state before effect cleanup;
late replies cannot start a turn for the new identity. The pending and history
queries are independent reads, not a database snapshot: if a concurrent review
makes them contradictory, the response fails closed and must be refreshed.

The browser writes a secret-free, account/session-scoped marker before each
reserve, begin, hold or resolve request. A lost response, invalid success or
unasserted error leaves the marker after reload. An empty read does not clear it:
a delayed request may still commit. New starts and release of a hold require
explicit acknowledgment, while a protective hold remains available even with a
warning or failed marker storage. If storage fails, an uncertain hold cannot be
remembered reliably after reload. Acknowledging is a human attestation, not proof
that the previous request stopped or that an external effect is reconciled.
Only a validated success or an explicit pre-dispatch/CAS rejection removes that
request's marker. The existing server ledger, revision fences and budget still
apply; no automatically replayed mutation or continuation is introduced.
Markers are not locks: concurrent tabs, devices, old clients and cleared
browser storage can bypass or lose them. Another tab can acknowledge a marker
while its request runs, and holding cannot recall a dispatch that has already
begun. Ordinary chat remains outside the continuation budget. Local fake and
PGlite tests do not establish hosted concurrency or device behavior.

## Approval and question response interruptions

Before this browser sends an Eve human-input response (including shell, MCP,
web approvals and questions), it writes an account/session-scoped marker with
only a SHA-256 digest of the request ID. Plain chat sent while a prompt is open
also writes a marker for the first locally open request because Eve may interpret
that text as an answer or withdraw the prompt. The digest is not encryption and
low-entropy IDs could be guessed. The marker contains no answer, decision,
command, arguments or provider credential. A storage or secure-hashing failure
blocks the response rather than dispatching it without the warning. An
unconfirmed response remains marked across reload; neither a rejected promise
nor a resolved `respond()` promise alone establishes what the server did.
For an explicit `respond()`, an authoritative `input.resolved` stream event for
the same request clears the matching marker, because Eve declares the request
terminal; this confirms the input outcome, not completion of the resulting tool
or external action. A plain-message marker always requires manual review: if the
local prompt snapshot was stale, the text could have affected another request,
so resolution of the locally observed request alone is not enough.
Optimistic `client.input.responded` and an empty stream do not clear it.

While a marker remains, the session blocks other human-input responses and new
messages, including text that Eve might interpret as an answer to an open prompt.
It rechecks before dispatch after chat-index persistence. Stop and reconnect
remain available. A user may explicitly acknowledge after inspecting the
conversation and external effects; the acknowledgment cannot cancel an earlier
response or prove the remote action's outcome. The local wait for `respond()` is
limited to 30 seconds without aborting Eve's stream; the same review timer is
used for plain chat that could answer a prompt. Afterward, the remote request
can still complete. Review is disabled during that local wait but other
browser tabs can acknowledge independently. The marker is a breadcrumb, not a
cross-tab lock or server idempotency key; simultaneous tabs, other devices, old
clients, direct APIs and cleared storage are outside its protection. A malformed
marker blocks conservatively. At most 2,000 account markers are stored, and
only the latest 2,000 terminal input IDs in the available stream are considered
for automatic clearing; missing history requires manual review. These changes do
not change Eve approval policy, bypass prompts, retry a remote tool, or promise
exactly-once effects. Tests use mocked Eve events and local storage, not actual
MCP providers, shell execution or hosted workflow infrastructure.

### Stop and reconnect uncertainty (local Phase 18)

A Stop for an observed active turn uses Eve 0.83.2's documented fixed-session `cancel({turnId, signal})`, including the owner proof. This avoids relying on the hook's potentially unscoped session cancellation after a resume or accepted follow-up. If no usable turn ID has been observed, the protective hook `cancel()` remains available; it may wait for a turn or use an unscoped session cancellation. **A late unscoped stop may affect a later turn.** Stop remains available even if the browser cannot save a marker.

Before requesting Stop, the UI attempts to save a per-account, per-session browser-local breadcrumb containing only the session and, when fixed-scoped, turn identifier. A 15-second local wait bounds the Stop request; the signal aborts the fixed-session transport, but neither a timeout nor an abort/rejection proves what the server received or undoes any side effect. The hook cancellation has no signal, so it may continue after the local wait. A rejection, timeout, `accepted`, or `no_active_turn` alone does not clear the warning. While it remains, messages, approval/question responses, and continuation starts are blocked; drafts and protective Stop remain available. Reconnecting is read-only and no Stop or external action is automatically replayed.

Only a matching durable `turn.cancelled` event followed by `session.waiting` clears a fixed-turn marker automatically, and only after the local request wait has settled. A projection, a different turn, `turn.completed`, or `turn.failed` does not. An unscoped or malformed marker requires an explicit human review. The acknowledgment is an attestation, not proof of completion, cancellation, or external-effect reconciliation; it cannot retract a late request. Even a matching cancellation event cannot undo shell processes, MCP calls, web requests, or remote effects that already started or continue independently. Inspect the conversation and external services before continuing.

Markers are a browser recovery hint, not a cross-tab lock, server ledger, authorization control, or guarantee across devices. Other same-origin tabs can observe stored markers, but simultaneous starts are not serialized. Clearing storage loses them; if marker creation fails, Stop still runs and an in-memory warning lasts only until unmount/reload. If storage cannot be read, follow-ups fail closed until storage is restored. A full or unavailable store cannot guarantee recovery after reload. Local mocked tests do not establish Eve hosting, network, or external-service behavior.

Reconnect's local UI wait is also bounded to 15 seconds; it does not abort `resume()` or stop the server turn. Eve may keep `resume()` pending while following a healthy stream and may reuse a still-pending resume promise, so a local timeout or repeated reconnect click does not guarantee a fresh connection. If stuck, reload and inspect the durable conversation and external activity; reload does not cancel the turn. The existing limited automatic reconnection only reads the stream and never resends a message or replays a tool call.

### Cross-tab dispatch breadcrumbs (local Phase 19)

In addition to the original sessionStorage hint, a send or explicit steer now attempts to write a browser-local, account- and session-scoped marker before calling Eve. It stores only the session identifier and a random marker key, not the message, tool arguments, approvals, or credentials. Other same-origin tabs using the same browser profile can see these markers and block new messages, approval/question responses and continuation starts while the marker remains. The active sending component excludes its own markers so healthy same-tab steering and answers to its own active turn remain possible. Stop and reconnect remain available. A queued message rechecks after history persistence and again before dispatch; a second read after marker creation narrows, but does not eliminate, concurrent-tab races.

An uninterrupted local `send()` settlement without the existing error/Stop/identity-change guards removes that component's unchanged marker; this is **not** proof that the overall task succeeded or that shell, web, MCP or other external effects completed. A rejection, Eve error callback, Stop race, changed account/session, or unmount leaves a marker for explicit inspection. A late promise after unmount cannot automatically clear either the shared marker or the original tab-local marker. A marker whose contents changed is not silently removed. Review acknowledges one specifically observed marker at a time, not all markers, and cannot recall or cancel a request another tab already started. The owner should inspect the conversation and the external service before deciding what to do next; the UI never automatically resends a message or replays an external action.

This is **not** a lock, atomic cross-tab fence, server-side idempotency key, operation ledger or proof of a remote outcome. Two tabs can still race between independent localStorage reads/writes; another tab can acknowledge a marker while the original send is running. Existing tabs using older code, other profiles/devices, direct API clients and cleared storage are outside its protection. The marker cap is 2,000 per account, and corrupt records block conservatively across that account. If the shared marker cannot be written, the previous same-tab best-effort behavior is preserved with a visible warning: the send may proceed, but another tab or reload might not see the warning. Unreadable recovery storage blocks sends until restored; Stop remains available. Browser storage and the original tab-local marker can be cleared or unavailable. No permissions, approvals, billing limits or Eve tool contracts change. The tests simulate browser storage/events and mocked Eve; they do not establish hosted, cross-device or third-party behavior.
