-- Vercel principals are not Supabase JWTs. Only the trusted Next service may
-- access this index; every request must independently authenticate the owner
-- and validate an ownership proof before creating or modifying a row.
create table public.tflash_vercel_history_owners (
  owner_id text primary key check (length(owner_id) between 1 and 512)
);
create table public.tflash_vercel_chats (
  session_id text primary key check (session_id ~ '^[a-zA-Z0-9_-]{1,200}$'),
  owner_id text not null references public.tflash_vercel_history_owners(owner_id),
  title text check (title is null or length(title) between 1 and 120),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index tflash_vercel_chats_owner_recent on public.tflash_vercel_chats(owner_id,updated_at desc) where deleted_at is null and title is not null;
alter table public.tflash_vercel_history_owners enable row level security;
alter table public.tflash_vercel_chats enable row level security;
revoke all on public.tflash_vercel_history_owners, public.tflash_vercel_chats from public, anon, authenticated;
grant select, insert, update on public.tflash_vercel_history_owners to service_role;
grant select, insert, update on public.tflash_vercel_chats to service_role;

-- Serialize capacity, imports, updates and tombstones for each account.
create function public.tflash_vercel_history_lock(p_owner text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_owner is null or length(p_owner) not between 1 and 512 then raise exception 'Invalid owner'; end if;
  insert into public.tflash_vercel_history_owners(owner_id) values (p_owner) on conflict do nothing;
  perform owner_id from public.tflash_vercel_history_owners where owner_id=p_owner for update;
end $$;

create function public.tflash_vercel_history_import(p_owner text, p_chats jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare item jsonb; inserted integer := 0; changed integer; sid text; title_value text; ms numeric;
begin
  if jsonb_typeof(p_chats) <> 'array' or jsonb_array_length(p_chats)>100 then raise exception 'Invalid history'; end if;
  perform public.tflash_vercel_history_lock(p_owner);
  for item in select value from jsonb_array_elements(p_chats) loop
    sid := item->>'id'; title_value := btrim(item->>'title'); ms := (item->>'updatedAt')::numeric;
    if sid is null or sid !~ '^[a-zA-Z0-9_-]{1,200}$' or title_value is null or length(title_value) not between 1 and 120 or ms is null or ms < 0 or ms > 4102444800000 then raise exception 'Invalid history item'; end if;
    if not exists (select 1 from public.tflash_vercel_chats where session_id=sid) then
      if (select count(*) from public.tflash_vercel_chats where owner_id=p_owner)>=5000 then raise exception 'History capacity exceeded'; end if;
      insert into public.tflash_vercel_chats(session_id,owner_id,title,updated_at)
        values (sid,p_owner,title_value,least(to_timestamp(ms/1000.0),now())) on conflict do nothing;
      get diagnostics changed = row_count; inserted := inserted + changed;
    end if;
  end loop;
  return inserted;
end $$;

create function public.tflash_vercel_history_update(p_owner text,p_session text,p_title text,p_activity boolean) returns text
language plpgsql security invoker set search_path='' as $$
declare result text;
begin
  if p_session is null or p_session !~ '^[a-zA-Z0-9_-]{1,200}$' or p_title is null or length(btrim(p_title)) not between 1 and 120 or p_activity is null then raise exception 'Invalid history update'; end if;
  perform public.tflash_vercel_history_lock(p_owner);
  if not exists(select 1 from public.tflash_vercel_chats where session_id=p_session) then
    if (select count(*) from public.tflash_vercel_chats where owner_id=p_owner)>=5000 then raise exception 'History capacity exceeded'; end if;
    insert into public.tflash_vercel_chats(session_id,owner_id,title) values(p_session,p_owner,btrim(p_title)) on conflict do nothing;
  end if;
  update public.tflash_vercel_chats set title=case when p_activity then coalesce(title,btrim(p_title)) else btrim(p_title) end, updated_at=now()
    where session_id=p_session and owner_id=p_owner and deleted_at is null returning title into result;
  return result;
end $$;

create function public.tflash_vercel_history_remove(p_owner text,p_session text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_session is null or p_session !~ '^[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid session'; end if;
  perform public.tflash_vercel_history_lock(p_owner);
  if not exists(select 1 from public.tflash_vercel_chats where session_id=p_session) then
    if (select count(*) from public.tflash_vercel_chats where owner_id=p_owner)>=5000 then raise exception 'History capacity exceeded'; end if;
    insert into public.tflash_vercel_chats(session_id,owner_id,deleted_at) values(p_session,p_owner,now()) on conflict do nothing;
  end if;
  update public.tflash_vercel_chats set deleted_at=coalesce(deleted_at,now()), title=null
    where session_id=p_session and owner_id=p_owner;
  get diagnostics changed = row_count;
  return changed=1;
end $$;
revoke all on function public.tflash_vercel_history_lock(text), public.tflash_vercel_history_import(text,jsonb), public.tflash_vercel_history_update(text,text,text,boolean), public.tflash_vercel_history_remove(text,text) from public, anon, authenticated;
grant execute on function public.tflash_vercel_history_lock(text), public.tflash_vercel_history_import(text,jsonb), public.tflash_vercel_history_update(text,text,text,boolean), public.tflash_vercel_history_remove(text,text) to service_role;
