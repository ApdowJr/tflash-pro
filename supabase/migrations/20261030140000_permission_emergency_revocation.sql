-- Serialize grants and emergency revocation per owner/conversation. Keep epoch
-- rows permanently: deleting them can let stale requests become valid again.
create table public.tflash_permission_epochs (
  owner_kind text not null check (owner_kind in ('supabase','vercel')),
  owner_id text not null check (length(owner_id) between 1 and 512),
  session_id text not null check (length(session_id) between 1 and 200),
  revision uuid not null default gen_random_uuid(),
  primary key (owner_kind, owner_id, session_id)
);
alter table public.tflash_permission_epochs enable row level security;
revoke all on public.tflash_permission_epochs from anon, authenticated;
grant select, insert, update on public.tflash_permission_epochs to service_role;
insert into public.tflash_permission_epochs (owner_kind,owner_id,session_id)
select distinct owner_kind,owner_id,session_id from public.tflash_permission_grants
on conflict do nothing;

create function public.tflash_ensure_permission_epoch(p_kind text, p_owner text, p_session text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  insert into public.tflash_permission_epochs (owner_kind,owner_id,session_id)
    values (p_kind,p_owner,p_session) on conflict do nothing;
  select revision into strict result from public.tflash_permission_epochs
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session;
  return result;
end $$;

create function public.tflash_change_web_grant(p_kind text, p_owner text, p_session text, p_origin text, p_revision uuid, p_epoch uuid, p_revoke boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_epoch uuid; updated integer;
begin
  select revision into current_epoch from public.tflash_permission_epochs
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if current_epoch is null or current_epoch <> p_epoch or p_epoch is null then return false; end if;
  if p_revoke and p_revision is null then return false; end if;
  if p_revision is null then
    insert into public.tflash_permission_grants (owner_kind,owner_id,session_id,origin,expires_at,revision)
      values (p_kind,p_owner,p_session,p_origin,now() + interval '1 hour',gen_random_uuid()) on conflict do nothing;
  else
    update public.tflash_permission_grants set revision=gen_random_uuid(),
      expires_at=case when p_revoke then '1970-01-01 00:00:00+00'::timestamptz else now() + interval '1 hour' end
      where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and origin=p_origin and revision=p_revision;
  end if;
  get diagnostics updated = row_count;
  return updated = 1;
end $$;

create function public.tflash_revoke_web_grants(p_kind text, p_owner text, p_session text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform public.tflash_ensure_permission_epoch(p_kind,p_owner,p_session);
  -- UPDATE acquires the same row lock as a grant change. Either all earlier
  -- grants are expired or a stale later grant fails its epoch comparison.
  update public.tflash_permission_epochs set revision=gen_random_uuid()
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session;
  update public.tflash_permission_grants set expires_at='1970-01-01 00:00:00+00'::timestamptz, revision=gen_random_uuid()
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session;
  return true;
end $$;

create function public.tflash_has_web_grant(p_kind text, p_owner text, p_session text, p_origin text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.tflash_permission_grants g
    join public.tflash_permission_epochs e using(owner_kind,owner_id,session_id)
    where g.owner_kind=p_kind and g.owner_id=p_owner and g.session_id=p_session and g.origin=p_origin and g.expires_at > now());
$$;
revoke all on function public.tflash_ensure_permission_epoch(text,text,text) from public, anon, authenticated;
revoke all on function public.tflash_change_web_grant(text,text,text,text,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.tflash_revoke_web_grants(text,text,text) from public, anon, authenticated;
revoke all on function public.tflash_has_web_grant(text,text,text,text) from public, anon, authenticated;
grant execute on function public.tflash_ensure_permission_epoch(text,text,text) to service_role;
grant execute on function public.tflash_change_web_grant(text,text,text,text,uuid,uuid,boolean) to service_role;
grant execute on function public.tflash_revoke_web_grants(text,text,text) to service_role;
grant execute on function public.tflash_has_web_grant(text,text,text,text) to service_role;
