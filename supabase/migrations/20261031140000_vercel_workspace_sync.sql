-- Vercel identities are verified by the Next server, not Supabase JWTs.
-- The service must scope every operation to the authenticated principal.
create table public.tflash_vercel_workspaces (
  owner_id text primary key check (length(owner_id) between 1 and 512),
  workspace jsonb not null check (jsonb_typeof(workspace) = 'object' and pg_column_size(workspace) <= 250000),
  updated_at timestamptz not null
);
alter table public.tflash_vercel_workspaces enable row level security;
revoke all on public.tflash_vercel_workspaces from public, anon, authenticated;
grant select, insert, update on public.tflash_vercel_workspaces to service_role;
