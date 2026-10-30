-- Keep revoked/expired rows as tombstones so stale tabs cannot recreate a grant.
-- The service-only table's existing privileges and RLS remain unchanged.
alter table public.tflash_permission_grants
  add column revision uuid not null default gen_random_uuid();
