# Optional Vercel workspace sync

This separately opt-in feature syncs projects, project instructions, manually
curated notes, the memory inclusion switch and the model-call limit for a
verified Vercel account. Vercel identities are Better Auth principals, not
Supabase JWTs: Next checks the principal and scopes every service-role request
to its ID. A separate service-only table is used; no Vercel identity is mapped
to an RLS-authenticated Supabase user's row. Chat index/proof sync is a separate
feature and setting, and this feature does not sync Eve transcripts or files.

The operator flag is **off by default**; with it off Vercel workspaces remain
browser-local. This code does not deploy, apply migrations, create resources,
or change hosted settings. To enable, first obtain explicit approval, back up
and reconcile the intended project, and validate the migration and real
PostgREST/CAS behavior in isolated nonproduction infrastructure. Review the
sensitivity and retention of workspace data before copying it into a database.

After separate approval, apply
`20261031140000_vercel_workspace_sync.sql` to the intended project and configure
`TFLASH_VERCEL_WORKSPACE_SYNC=1`, `TFLASH_VERCEL_WORKSPACE_SUPABASE_URL`, and
`TFLASH_VERCEL_WORKSPACE_SERVICE_ROLE_KEY` on the Next server. Never expose the
service-role key to clients or use a `NEXT_PUBLIC_` variable. A service-role key
is broadly privileged: restrict its distribution and rotate it securely. This
flag and key are independent of Vercel chat-history sync. An enabled but
unconfigured or unavailable service returns an error, not a silent downgrade.
Coordinate all application instances and validate with test accounts before
rollout; older instances that only use local storage do not sync their changes.

On initial load, a valid local copy is uploaded only if the account has no cloud
copy. An empty new device can load the cloud copy. Different local and cloud
copies are retained as a conflict until the user explicitly chooses one to
replace the other. Writes use an owner-scoped compare-and-set revision; stale
updates and simultaneous first inserts are rejected. Local edits during initial
discovery remain local until the remote copy is checked. A failed or uncertain
write retains the local copy; queued edits are not sent after an uncertain
write. Use **Retry workspace sync** to read the cloud again, then explicitly
choose a copy even if the visible values match. A timed-out request may still
commit; reviewing cannot cancel it. Account-scoped operation markers, containing identifiers but no synced content, survive reloads in browser
localStorage. If marker storage is unavailable, cloud writes fail closed.
Markers are not a cross-tab lock and clearing browser storage loses them. Corrupt local data is not automatically replaced by the cloud copy.
Sync runs on workspace load and edits, not as a background polling service;
reload on another device to check for newer data. A revision conflict after
concurrent changes needs human resolution, not an automatic merge.

The database holds workspace notes and instructions in ordinary server-side
storage, not end-to-end encrypted; browser storage is also not a security
boundary. Do not store credentials or secrets in these notes. Enabling memory
still controls which notes are supplied to the selected model as untrusted
context; synchronization does not grant permissions or bypass approvals.
Deleting or clearing a workspace does not guarantee erasure of browser copies,
backups, prior prompts, or provider data. Turning the flag off returns to local
storage but leaves cloud rows intact; changes made while disabled do not sync.
Plan coordinated rollback and retention before disabling or re-enabling it.
Local tests use PGlite and mocked HTTP/UI; they do not prove live hosted or
concurrent Postgres/PostgREST behavior.
