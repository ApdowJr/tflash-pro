-- Tflash conversation index. Conversation transcripts remain in eve's workflow store.
-- The app verifies owner_proof server-side in addition to these RLS policies.
create table public.tflash_chats (
  session_id text primary key check (char_length(session_id) between 1 and 200),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_proof text not null check (char_length(owner_proof) between 32 and 128),
  title text check (title is null or char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tflash_chats_user_updated_idx
  on public.tflash_chats (user_id, updated_at desc)
  where title is not null;

alter table public.tflash_chats enable row level security;
revoke all on public.tflash_chats from anon;
grant select, insert, update, delete on public.tflash_chats to authenticated;

create policy "Users can read their Tflash chats"
  on public.tflash_chats for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their Tflash chats"
  on public.tflash_chats for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their Tflash chats"
  on public.tflash_chats for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can remove their Tflash chats"
  on public.tflash_chats for delete to authenticated
  using ((select auth.uid()) = user_id);
