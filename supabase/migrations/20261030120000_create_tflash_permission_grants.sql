-- Server-only; neither browser authentication mode may access these tables directly.
create table public.tflash_permission_grants (
  owner_kind text not null check (owner_kind in ('supabase','vercel')),
  owner_id text not null check (length(owner_id) between 1 and 512),
  session_id text not null check (length(session_id) between 1 and 200),
  origin text not null check (length(origin) between 1 and 2048),
  expires_at timestamptz not null,
  primary key(owner_kind,owner_id,session_id,origin)
);
alter table public.tflash_permission_grants enable row level security;
revoke all on public.tflash_permission_grants from anon, authenticated;
grant select, insert, update, delete on public.tflash_permission_grants to service_role;
create table public.tflash_tracked_tasks (
  owner_kind text not null check (owner_kind in ('supabase','vercel')),
  owner_id text not null check (length(owner_id) between 1 and 512),
  session_id text not null check (length(session_id) between 1 and 200),
  revision uuid not null, objective text not null check (length(objective) between 1 and 500),
  path text not null check (length(path) between 1 and 200), sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  continuation_budget integer not null check (continuation_budget between 0 and 3),
  state text not null check (state in ('awaiting_evidence','criterion_matched','cancelled')),
  verified_at timestamptz, reason text, primary key(owner_kind,owner_id,session_id)
);
alter table public.tflash_tracked_tasks enable row level security;
revoke all on public.tflash_tracked_tasks from anon, authenticated;
grant select, insert, update, delete on public.tflash_tracked_tasks to service_role;
