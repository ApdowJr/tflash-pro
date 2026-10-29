-- Per-user workspace sync for projects, opt-in memory notes, and model-call limits.
-- Transcripts and provider/integration credentials are intentionally not stored here.
create table public.tflash_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace jsonb not null,
  updated_at timestamptz not null default now(),
  constraint tflash_workspaces_object check (jsonb_typeof(workspace) = 'object'),
  constraint tflash_workspaces_size check (pg_column_size(workspace) <= 200000)
);

alter table public.tflash_workspaces enable row level security;
revoke all on public.tflash_workspaces from anon;
grant select, insert, update, delete on public.tflash_workspaces to authenticated;

create policy "Users can read their Tflash workspace"
  on public.tflash_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their Tflash workspace"
  on public.tflash_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their Tflash workspace"
  on public.tflash_workspaces for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can remove their Tflash workspace"
  on public.tflash_workspaces for delete to authenticated
  using ((select auth.uid()) = user_id);