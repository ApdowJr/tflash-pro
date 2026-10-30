# Database security advisors — 2026-10-30

Project reviewed through the Supabase MCP server:
`https://uatpsywxzdkdjhbclzve.supabase.co` (`uatpsywxzdkdjhbclzve`).
This pass is repository-only. No production migration, auth setting, deploy or
push was performed.

## Root cause

The live project contains schema objects that are not in the committed
migrations:

- `public.tflash_messages` (the entire table, constraints, indexes, RLS
  policies and ownership trigger),
- `public.tflash_chats.owner_proof_hash` and its unique index,
- `public.tflash_fill_owner_proof_hash()` and its trigger,
- `public.tflash_messages_check_owner()` and its trigger,
- `public.touch_updated_at()` and its triggers on `tflash_chats` and
  `tflash_workspaces`,
- `public.tflash_verify_owner_proof(text, text)`,
- the live full index `tflash_chats_user_updated_full_idx` instead of the
  committed partial index `tflash_chats_user_updated_idx`.

They were added directly to the project rather than through
`supabase/migrations/`. The advisor is therefore reporting a real grant on a
function the repository never reviews or applies.

The committed migrations only use `owner_proof` and the RLS policies in
`supabase/migrations/20261028075927_create_tflash_chats.sql`. The application
verifies ownership with the HMAC in `lib/security/chat-ownership.ts`:

- `lib/security/owned-chat.ts`,
- `agent/channels/eve.ts`,
- `app/api/chats/route.ts`,
- `components/chat/authenticated-agent-chat.tsx`.

No runtime file in `app/`, `agent/`, `components/` or `lib/` calls the RPC.

## Wider production schema drift

Read-only inspection through MCP found more drift than the advisor reported.
This is an inventory of observed production objects, not approval to change
them.

| Live object / behavior | Committed migrations | Drift |
| --- | --- | --- |
| `tflash_chats` base table and four owner RLS policies | `20261028075927_create_tflash_chats.sql` | Base columns and policies match. Live adds `owner_proof_hash`, its unique index, the hash-fill trigger and `touch_updated_at`. |
| `tflash_messages` table | **None** | Entire table is absent from the repository: `id`, `session_id`, `user_id`, `role`, `content`, `metadata`, `created_at`; role/content/metadata/size checks; FKs to `tflash_chats` and `auth.users`; four RLS policies; primary key plus session/created and user/created indexes; owner-check trigger. It has 0 rows. |
| `tflash_workspaces` base table and four owner RLS policies | `20261029120000_create_tflash_workspace_sync.sql`, `20261029132311_widen_tflash_workspace_jsonb_size_limit.sql` | Base columns, constraints and policies match. Live adds the `touch_updated_at` trigger. |
| Trigger helpers | **None** | `tflash_fill_owner_proof_hash()`, `tflash_messages_check_owner()` and `touch_updated_at()` are live but not in migrations. |
| Chat indexes | `tflash_chats_user_updated_idx` (partial, `title is not null`) | Live has `tflash_chats_user_updated_full_idx` instead; the committed partial index is not live. Live also has `tflash_chats_owner_proof_hash_key`. |
| Table grants | `revoke all ... from anon; grant select, insert, update, delete ... to authenticated` | Live `authenticated` also has `TRUNCATE`, `REFERENCES` and `TRIGGER` on all three tflash tables. |
| Extension dependency | **None** | `pgcrypto` is installed in the `extensions` schema; the hash and verify functions call `extensions.digest`. |

### Grant finding (high priority)

The `public` schema default ACL grants `Dxtm` — the observed table privileges
are `TRUNCATE`, `REFERENCES` and `TRIGGER` — to `anon`, `authenticated` and
`service_role` on newly created tables. The committed chat
and workspace migrations revoke all privileges from `anon` but never revoke the
default table privileges from `authenticated` before adding DML grants. As a
result, live `authenticated` retains `TRUNCATE`, `REFERENCES` and `TRIGGER` in
addition to the intended `SELECT`, `INSERT`, `UPDATE`, `DELETE`.

RLS does not protect `TRUNCATE`. PostgREST does not expose `TRUNCATE` or table
DDL directly, so this is not an immediate remote exploit through the current
API, but it violates least privilege and becomes dangerous if SQL or a
`SECURITY DEFINER` RPC is ever exposed. This finding is documented, not fixed in
this change. A separate reviewed migration should revoke only the excess
privileges, then re-test PostgREST and the app.

## 1. `tflash_verify_owner_proof`

### What it does

Live definition (summarised from `pg_get_functiondef`):

```sql
create function public.tflash_verify_owner_proof(p_session_id text, p_proof text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists (
    select 1
    from public.tflash_chats c
    where c.session_id = p_session_id
      and c.owner_proof_hash = encode(extensions.digest(p_proof, 'sha256'), 'hex')
  );
$$;
```

The function is owned by `postgres`. Its live ACL grants `EXECUTE` to
`authenticated` (and to the owner). It is not scoped by `auth.uid()` or
`user_id`, so any signed-in caller could use it against any session ID if they
already knew that session's proof. The proof is a high-entropy HMAC, which makes
brute force impractical, but the grant is still unnecessary: it is a
`SECURITY DEFINER` oracle outside RLS.

### Why authenticated users do not need it

The browser never calls this RPC. The Next.js route reads `owner_proof` under
RLS and calls `verifyChatOwnership`; the Eve channel repeats that check. The RLS
policies use only `(select auth.uid()) = user_id`. No policy, trigger or runtime
path depends on the function.

### Fix

`supabase/migrations/20261030120000_harden_owner_proof_rpc.sql` conditionally
revokes `EXECUTE` from `PUBLIC`, `anon` and `authenticated`, while leaving the
function available to the database owner. The condition makes the migration a
no-op on a fresh project where the out-of-band function was never created.

The function was deliberately **not dropped** in this pass. Revocation is the
smallest reversible change and avoids breaking any undocumented administrative
use. If the function is later confirmed unused everywhere, dropping it can be a
separate, explicit migration.

## 2. Leaked password protection

The security advisor reports `auth_leaked_password_protection` as disabled.

Supabase documents leaked-password protection as available on the **Pro Plan and
above**:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

The project's billing plan cannot be read through the database MCP tools, so
this repository change does not claim the setting was enabled. Check the plan
first; if the project is on Free, upgrading to Pro is a prerequisite.

### Dashboard change (owner action)

1. Open the project in the Supabase Dashboard.
2. Confirm the organization/project is on Pro or above
   (**Organization → Billing**).
3. Go to **Authentication → Providers → Email**
   (`/dashboard/project/<ref>/auth/providers?provider=Email`).
4. Enable **Prevent use of leaked passwords** (the UI may label it **Leaked
   password protection**).
5. Save the provider settings.
6. Re-run the security advisor and confirm
   `auth_leaked_password_protection` is gone.

### Management API alternative (owner action)

With a personal access token that has `auth:write`, `auth_config_write` and
`project_admin_write`:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/uatpsywxzdkdjhbclzve/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password_hibp_enabled":true}'
```

This changes production settings and was **not** executed. The `password_hibp_enabled`
field is part of the documented Management API auth config.

## 3. Unused indexes

The performance advisor lists three unused indexes:

- `tflash_chats_user_updated_full_idx`
- `tflash_messages_session_created_idx`
- `tflash_messages_user_created_idx`

Decision: **keep all three**. The project currently has 21 chats, 1 workspace
and 0 messages. That is not enough workload evidence to justify a drop, and the
advisor's "unused" signal is expected for a new/low-traffic table. No index is
dropped by this change; the decision is recorded in the new migration comment.

The live project has `tflash_chats_user_updated_full_idx`, while the committed
chat migration creates the partial index `tflash_chats_user_updated_idx`. That
mismatch is part of the reconciliation plan below; nothing is dropped here.

## Safe reconciliation plan

Do **not** run `supabase db push` against this project yet. The remote migration
ledger has only the three committed versions, but the live schema contains
unversioned objects. A blind push can produce a misleading or partial history.

1. **Snapshot first.** Take a database backup and capture schema-only output
   (`pg_dump --schema-only` or the approved Supabase CLI dump). Store it outside
   the repository. Do not edit the production migration ledger before the
   snapshot is verified.
2. **Decide keep versus remove, object by object.** In particular, decide whether
   `tflash_messages` and the owner-proof hash/RPC machinery are still part of the
   product. The app has no runtime reference to `tflash_messages` and it has 0
   rows, but that is not enough evidence to drop it. The same applies to
   `owner_proof_hash`; the RPC itself is locked down by the new migration.
3. **Generate the reconciliation DDL from production, do not hand-write it.**
   Use the reviewed dump or `supabase db diff` output for the chosen canonical
   schema. If the decision is to keep the objects, the migration should reproduce
   the observed table, constraints, indexes, RLS policies, functions and
   triggers. If the decision is to remove an object, make that a separate,
   explicit migration with its own backup and review.
4. **Rehearse on a disposable project or Supabase branch.** Apply every committed
   migration from zero, then the reconciliation migration, and compare the result
   with production. Run the migration tests, RLS tests and the app integration
   tests against that project. Do not use production as the test bed.
5. **Fix grants separately.** A dedicated migration should revoke only the
   excess `TRUNCATE`, `REFERENCES` and `TRIGGER` privileges from `authenticated`
   on `tflash_chats`, `tflash_messages` and `tflash_workspaces`, leaving the
   intended DML grants. Re-test PostgREST, RLS and the app afterwards. Consider
   whether the `public` default ACL should also stop granting those privileges
   to future tables.
6. **Handle the index mismatch deliberately.** Keep the three advisor-listed
   indexes for now. If the partial index is still wanted on fresh projects, add
   it in its own `CREATE INDEX CONCURRENTLY` migration; do not drop the full
   index without query-statistics evidence.
7. **Reconcile the migration ledger last.** After the schema has been replayed
   and verified on a disposable project, use the approved `supabase migration
   repair` workflow if history needs correcting. Do not rewrite production
   history merely to make `db push` quiet.
8. **Rollback plan.** DDL should run in a transaction where possible; concurrent
   index creation cannot. Keep the pre-change schema dump and a tested rollback
   statement for every grant or object change.

## Validation

- `tests/owner-proof-hardening.test.mjs` applies every migration to PGlite,
  confirms the hardening migration is safe when the RPC is absent, simulates the
  production grant, applies the hardening migration, and asserts:
  - `authenticated` and `anon` can no longer execute the RPC,
  - the database owner can still execute it,
  - the RLS-protected owner row still works.
- The same test scans runtime source for RPC call sites and verifies the HMAC
  checks remain in `owned-chat.ts` and `agent/channels/eve.ts`.
- Existing migration, RLS and owner-proof tests remain in the suite.

## Applying to production (not done)

Requires explicit approval:

1. Review the new migration and the drift list above.
2. Apply
   `supabase/migrations/20261030120000_harden_owner_proof_rpc.sql` through the
   approved Supabase migration workflow. It is safe to run against the current
   project because the function exists; it is a no-op elsewhere.
3. Verify:
   ```sql
   select has_function_privilege(
     'authenticated',
     'public.tflash_verify_owner_proof(text,text)',
     'execute'
   );
   ```
   Expected: `false`.
4. Re-run the advisors. The `authenticated_security_definer_function_executable`
   warning should disappear; the leaked-password warning remains until the
   Dashboard/API change above is made by the owner.
