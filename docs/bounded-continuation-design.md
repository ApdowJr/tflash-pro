# Bounded, reconciled task continuation — design only

No automatic multi-turn scheduler, operation ledger, or provider adapter in this
document exists yet. The existing `continuationBudget` column is not enforced
for turns, and the UI currently sets it to zero. A file digest checks bytes at
one moment; a completed turn or model-authored plan does not verify an objective.
Do not enable unattended continuation by changing the budget field alone.

## Required safety properties

1. The owner explicitly authorizes a specific task revision, maximum additional
   turns (at most 3), deadline, per-turn model-step limit, and an overall
   enforceable spend/usage policy. A new task revision or revocation invalidates
   the authorization. Numeric cost reporting alone is not a spending cap.
2. Persist the task, operation attempts, authorization, remaining budget,
   cancellation epoch and worker fencing token in a service-only durable store.
   Atomically compare task revision/epoch, reserve **one** turn budget and
   register a unique dispatch attempt before any turn is sent. Concurrent tabs,
   workers and retries cannot reserve the same budget twice. Cancellation and
   claims are serialized and stale workers fail their fence checks.
3. Distinguish `reserved`, `dispatching`, `accepted`, `settled`, `reconciling`,
   `unknown`, `cancelled`, `verified` and `exhausted`. A database write and a
   remote turn dispatch are not one atomic transaction. Persist enough
   correlation to query the remote turn using a documented API. A timeout or
   crash after dispatch starts is **unknown**, not permission to resend. An
   expired lease only releases local ownership; it never makes an uncertain
   external call safe to repeat. A lease cannot revoke a network call already
   issued by a stale worker.
4. A remote operation may be automatically retried only with an individually
   documented provider idempotency contract bound to a stable, scoped operation
   key and exact payload, or after authoritative reconciliation proves the
   original had no effect and replay is safe. A remote lookup must distinguish
   not-yet-visible from not-executed. Model text, a remote tool name, MCP
   annotations and an Eve call ID alone are insufficient. If the contract or
   observation is missing, stop in `unknown` and require human reconciliation.
5. A new model turn may repeat an earlier effect even if the client merely
   intends to continue. Before starting it, reconcile *all* possible external
   effects, including tool calls and background shell processes, and restrict
   execution to adapters with enforceable operation identities and exact scopes.
   Generic shell/MCP calls must keep their per-call approvals and cannot be
   silently included in an automatic continuation. Human approval does not
   prove an earlier uncertain effect was absent. Do not pretend a local
   deduplication ledger alone guarantees exactly-once effects in third parties.
6. A new turn can begin only after the previous turn is durably terminal, the
   task remains active and unverified, all external effects are reconciled,
   policy/budget permits it, and the dispatch boundary is safe. A turn limit,
   rate limit, approval or tool input is not evidence of task failure/success.
   Cancellation wins over continuation claims and prevents *new* dispatches;
   it cannot recall an already-issued request or prove external rollback.
7. End in a truthful state: criterion verified, exhausted, stopped or waiting
   for user review. No automatic model-reported completion or unbounded retry.
   Revoked permissions are checked at execution, not only when scheduling.

## Recovery matrix

| Crash/interrupt point | Safe recovery |
| --- | --- |
| Before reservation commits | Re-read state; a fresh claim may be considered. |
| After reservation, demonstrably before dispatch | Reconcile durable intent; release or resume only if the system can prove no dispatch began. |
| During/after dispatch, before remote acknowledgement | Mark `unknown`; query the exact operation/turn where supported. Do not automatically re-send. |
| After acknowledgement, before settlement | Reattach to the same turn; do not start another. If history cannot be confirmed, stop. |
| During a provider tool call | Reconcile via the provider's own authoritative contract; absent that, stop for review. |
| Cancellation races any of the above | Invalidate future claims; request cooperative stop for the observed turn and observe its boundary. Already-started effects remain uncertain. |
| File digest match followed by file change | Reverify; historical match is not proof of current content or whole-task success. |

## Local and hosted acceptance gates before activation

- Model state transitions with unique identities, revision CAS, durable fencing,
  all crash points, lost responses, duplicate events, concurrent claims,
  cancellation and stale workers. Property tests must demonstrate that a budget
  is never spent twice and that unknown side effects are never resubmitted.
- Implement narrowly scoped integrations with *provider-specific*, tested
  idempotency and reconciliation contracts. Test ambiguity, delayed visibility,
  expiry of remote keys, payload mismatch and provider failure using disposable
  provider resources, not production. Do not inject arguments into arbitrary
  third-party MCP schemas.
- Verify the real Eve dispatch/observation API and persistent workflow world;
  do not invent an idempotency header, cross-turn call ID or runtime guarantee.
  Prove that budget/authorization guards cannot be bypassed by a model, another
  tab, a stale deployment, direct tool execution or retries.
- Exercise real PostgreSQL concurrent transactions and hosted PostgREST only
  after explicit nonproduction authorization; PGlite is not proof of concurrent
  PostgreSQL behavior. Validate deployment sequencing and old-version safety.
- Until all applicable gates pass, keep continuation manual with explicit
  review, per-action approvals and the existing limits; never auto-replay an
  unknown operation. Actual deployment and production migrations remain outside
  the scope of this design.
