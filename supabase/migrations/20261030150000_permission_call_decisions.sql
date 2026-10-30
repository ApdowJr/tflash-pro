-- Bind each reusable web decision to the exact grant and session epoch seen at
-- the Eve approval gate. Retain decisions while old workflow calls can replay.
create table public.tflash_web_call_decisions (
  owner_kind text not null check (owner_kind in ('supabase','vercel')),
  owner_id text not null check (length(owner_id) between 1 and 512),
  session_id text not null check (length(session_id) between 1 and 200),
  call_id text not null check (length(call_id) between 1 and 200),
  origin text not null check (length(origin) between 1 and 2048),
  grant_revision uuid not null,
  epoch_revision uuid not null,
  consumed boolean not null default false,
  primary key(owner_kind,owner_id,session_id,call_id)
);
alter table public.tflash_web_call_decisions enable row level security;
revoke all on public.tflash_web_call_decisions from public, anon, authenticated;
grant select, insert, update on public.tflash_web_call_decisions to service_role;

-- The epoch lock serializes decision issuance with grant/revoke/revoke-all.
-- Never overwrite an existing call's binding, even after revoke and regrant.
create function public.tflash_issue_web_decision(p_kind text, p_owner text, p_session text, p_origin text, p_call text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare epoch uuid; grant_rev uuid; decision_count integer;
begin
  if p_call is null or length(p_call) not between 1 and 200 then return false; end if;
  select revision into epoch from public.tflash_permission_epochs
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if epoch is null then return false; end if;
  select revision into grant_rev from public.tflash_permission_grants
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and origin=p_origin and expires_at > now();
  if grant_rev is null then return false; end if;
  if not exists (select 1 from public.tflash_web_call_decisions where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and call_id=p_call) then
    select count(*) into decision_count from public.tflash_web_call_decisions
      where owner_kind=p_kind and owner_id=p_owner and session_id=p_session;
    -- Fail closed rather than grow indefinitely for a long-lived conversation.
    if decision_count >= 2000 then return false; end if;
    insert into public.tflash_web_call_decisions (owner_kind,owner_id,session_id,call_id,origin,grant_revision,epoch_revision)
      values (p_kind,p_owner,p_session,p_call,p_origin,grant_rev,epoch) on conflict do nothing;
  end if;
  return exists (select 1 from public.tflash_web_call_decisions
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and call_id=p_call
      and origin=p_origin and grant_revision=grant_rev and epoch_revision=epoch and not consumed);
end $$;

create function public.tflash_has_web_decision(p_kind text, p_owner text, p_session text, p_origin text, p_call text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.tflash_web_call_decisions d
    join public.tflash_permission_grants g using(owner_kind,owner_id,session_id,origin)
    join public.tflash_permission_epochs e using(owner_kind,owner_id,session_id)
    where d.owner_kind=p_kind and d.owner_id=p_owner and d.session_id=p_session and d.call_id=p_call
      and d.origin=p_origin and d.grant_revision=g.revision and d.epoch_revision=e.revision and g.expires_at > now() and not d.consumed);
$$;
-- One call may make at most one grant-authorized socket attempt. Mark it
-- consumed before the socket: a lost response or failed connection remains
-- uncertain and is never automatically retried under the reusable grant.
create function public.tflash_consume_web_decision(p_kind text, p_owner text, p_session text, p_origin text, p_call text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare epoch uuid; changed integer;
begin
  select revision into epoch from public.tflash_permission_epochs
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if epoch is null then return false; end if;
  update public.tflash_web_call_decisions d set consumed=true
    from public.tflash_permission_grants g
    where d.owner_kind=p_kind and d.owner_id=p_owner and d.session_id=p_session
      and d.call_id=p_call and d.origin=p_origin and not d.consumed and d.epoch_revision=epoch
      and g.owner_kind=d.owner_kind and g.owner_id=d.owner_id and g.session_id=d.session_id
      and g.origin=d.origin and g.revision=d.grant_revision and g.expires_at > now();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.tflash_issue_web_decision(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.tflash_has_web_decision(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.tflash_issue_web_decision(text,text,text,text,text) to service_role;
grant execute on function public.tflash_has_web_decision(text,text,text,text,text) to service_role;
revoke all on function public.tflash_consume_web_decision(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.tflash_consume_web_decision(text,text,text,text,text) to service_role;
