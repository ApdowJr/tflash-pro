# Optional Vercel account chat-history sync

Vercel sign-in does not issue a Supabase JWT. This optional Next-server-only
index is separate from Supabase-authenticated `tflash_chats`: the server checks
Better Auth, scopes every query to that principal, and validates the existing
HMAC session ownership proof before accepting a legacy browser entry or a
mutation. The index stores session ID, title, timestamp and owner, not message
contents. A list response supplies signed proofs for those sessions to the
signed-in browser. Eve continues to enforce its existing session checks.

The feature is **off by default**. Existing browser-only Vercel history and
Supabase-account history retain their behavior when it is off. Enabling it on an
existing deployment needs explicit operator approval; neither this code nor
these instructions apply a migration or change a hosted configuration.

## Before enabling

1. Validate the migration `20261031130000_vercel_chat_history.sql` and route
   behavior in isolated nonproduction infrastructure. Verify service role
   bypasses RLS, grants, PostgREST RPC and coordinated instances. Do not use
   production as a test. Make a backup and arrange a rollback/retention plan.
2. Explicitly authorize and apply the migration to the intended project.
   Configure `TFLASH_VERCEL_HISTORY_SUPABASE_URL` and
   `TFLASH_VERCEL_HISTORY_SERVICE_ROLE_KEY` as private Next-server environment
   variables, and set `TFLASH_VERCEL_HISTORY_SYNC=1`. Never expose the key to
   browsers or put it in a `NEXT_PUBLIC_` variable. A Supabase service role is
   broadly privileged; secure and rotate it as a production secret.
3. Keep the same strong `TFLASH_SESSION_SECRET` on all Next/Eve instances;
   rotating it invalidates existing browser proofs and requires a separate
   migration/recovery plan. Deploy all instances coherently. Confirm behavior
   with test accounts before rollout. An enabled but unavailable/misconfigured
   index returns errors rather than silently downgrading to browser-only mode.

On sign-in/page load and window focus, a device imports up to 100 local entries
only when every entry has a valid principal/session proof, then reads the latest
100 titles and proofs. Old local data is retained if synchronization fails.
Imports never overwrite an existing row. A timed-out or failed import remains
uncertain: the tab keeps local data and requires an explicit refresh before
retrying it; it does not automatically retry on window focus or reload. Account-scoped markers, containing identifiers but no synced content, are stored in localStorage, and imports fail closed when
marker storage is unavailable. Markers are not a cross-tab lock and cannot
recall an already-started request; clearing browser storage loses them. New
imports require expected-account headers, so old clients need a refresh after
rollout. Rename and activity updates are
serialized per owner in SQL, and activity cannot undo a rename. Deletions leave
permanent index tombstones so stale clients cannot re-import the deleted entry.
Every owner has a 5,000-row limit including tombstones; reaching it fails closed
and needs an operator-reviewed retention solution, not blind tombstone pruning.

This is **not** cross-device transcript replication: actual message access
still depends on Eve storage/availability and its existing retention policy.
Deletion removes the history entry and requests best-effort Eve reset; it does
not revoke old signed proofs, guarantee erasure, or recall in-flight requests.
The local cache may remain on other devices until refreshed. Names are last
writer wins for simultaneous explicit renames; the index is limited to the 100
most recently updated visible conversations. Browser storage remains local and
is subject to the browser's own privacy and availability characteristics.

Disabling the flag restores browser-only operation but does not erase server
rows or tombstones; actions taken while disabled are not synchronized. Plan a
coordinated rollback and preserve tombstones if stale browsers may return.

Rename, remove and pre-send activity updates also leave a local uncertainty
marker if their outcome cannot be confirmed. Check the chat/account history
before acknowledging that warning; acknowledgement never repeats the action,
and cannot cancel an in-flight request. The marker survives reload but is not
a cross-tab lock, and clearing browser storage removes it. Removing a chat
still does not guarantee Eve workflow reset or data erasure.
