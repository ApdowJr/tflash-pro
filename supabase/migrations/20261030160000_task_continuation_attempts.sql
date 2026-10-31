-- A conservative, manually operated ledger. A reservation spends one turn
-- even when the response is lost. No row authorizes automatic redispatch.
create table public.tflash_task_continuation_attempts (
  owner_kind text not null check (owner_kind in ('supabase','vercel')),
  owner_id text not null check (length(owner_id) between 1 and 512),
  session_id text not null check (length(session_id) between 1 and 200),
  attempt_id uuid not null,
  task_revision uuid not null,
  state text not null check (state in ('reserved','dispatching','reviewed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) between 10 and 1000),
  primary key(owner_kind,owner_id,session_id,attempt_id)
);
create unique index tflash_one_unreviewed_continuation
  on public.tflash_task_continuation_attempts(owner_kind,owner_id,session_id)
  where state <> 'reviewed';
alter table public.tflash_task_continuation_attempts enable row level security;
revoke all on public.tflash_task_continuation_attempts from public, anon, authenticated;
grant select, insert, update on public.tflash_task_continuation_attempts to service_role;

create function public.tflash_reserve_continuation(p_kind text,p_owner text,p_session text,p_revision uuid,p_attempt uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare task public.tflash_tracked_tasks%rowtype; next_revision uuid;
begin
  if p_attempt is null or p_revision is null then return false; end if;
  -- Share the grant execution lock: reservations invalidate earlier automatic
  -- web decisions and prevent new ones until the attempt is reviewed.
  perform public.tflash_ensure_permission_epoch(p_kind,p_owner,p_session);
  perform revision from public.tflash_permission_epochs where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  select * into task from public.tflash_tracked_tasks where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if not found or task.revision<>p_revision or task.state<>'awaiting_evidence' or task.continuation_budget<=0 then return false; end if;
  if exists (select 1 from public.tflash_task_continuation_attempts where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and (state<>'reviewed' or attempt_id=p_attempt)) then return false; end if;
  -- Preserve all attempt tombstones; do not allow unlimited accumulation.
  if (select count(*) from public.tflash_task_continuation_attempts where owner_kind=p_kind and owner_id=p_owner and session_id=p_session) >= 2000 then return false; end if;
  next_revision := gen_random_uuid();
  update public.tflash_permission_epochs set revision=gen_random_uuid() where owner_kind=p_kind and owner_id=p_owner and session_id=p_session;
  update public.tflash_tracked_tasks set revision=next_revision,continuation_budget=continuation_budget-1
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session;
  insert into public.tflash_task_continuation_attempts(owner_kind,owner_id,session_id,attempt_id,task_revision,state)
    values(p_kind,p_owner,p_session,p_attempt,next_revision,'reserved');
  return true;
end $$;

-- Serializes with cancellation/replacement of the task. Once this transition
-- succeeds, a stop cannot recall a browser request that is already starting.
create function public.tflash_begin_continuation(p_kind text,p_owner text,p_session text,p_attempt uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare task public.tflash_tracked_tasks%rowtype; changed integer;
begin
  select * into task from public.tflash_tracked_tasks where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if not found or task.state<>'awaiting_evidence' then return false; end if;
  update public.tflash_task_continuation_attempts set state='dispatching'
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and attempt_id=p_attempt
      and state='reserved' and task_revision=task.revision;
  get diagnostics changed = row_count;
  return changed=1;
end $$;

-- This records only an explicit human review, never remote success or failure.
create function public.tflash_review_continuation(p_kind text,p_owner text,p_session text,p_attempt uuid,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_note is null or length(btrim(p_note)) not between 10 and 1000 then return false; end if;
  update public.tflash_task_continuation_attempts set state='reviewed',reviewed_at=now(),review_note=btrim(p_note)
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and attempt_id=p_attempt and state in ('reserved','dispatching');
  get diagnostics changed = row_count;
  return changed=1;
end $$;
revoke all on function public.tflash_reserve_continuation(text,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.tflash_begin_continuation(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.tflash_review_continuation(text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.tflash_reserve_continuation(text,text,text,uuid,uuid) to service_role;
grant execute on function public.tflash_begin_continuation(text,text,text,uuid) to service_role;
grant execute on function public.tflash_review_continuation(text,text,text,uuid,text) to service_role;

-- A model turn started by a budgeted attempt may revisit an uncertain GET.
-- Require individual approval while that attempt is pending. These functions
-- and reservation share the epoch row lock; an already-consumed socket cannot
-- be recalled. Replacing functions preserves their existing EXECUTE grants.
create or replace function public.tflash_issue_web_decision(p_kind text, p_owner text, p_session text, p_origin text, p_call text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare epoch uuid; grant_rev uuid; decision_count integer;
begin
  if p_call is null or length(p_call) not between 1 and 200 then return false; end if;
  select revision into epoch from public.tflash_permission_epochs
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if epoch is null then return false; end if;
  if exists (select 1 from public.tflash_task_continuation_attempts where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and state<>'reviewed') then return false; end if;
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

create or replace function public.tflash_consume_web_decision(p_kind text, p_owner text, p_session text, p_origin text, p_call text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare epoch uuid; changed integer;
begin
  select revision into epoch from public.tflash_permission_epochs
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if epoch is null then return false; end if;
  if exists (select 1 from public.tflash_task_continuation_attempts where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and state<>'reviewed') then return false; end if;
  update public.tflash_web_call_decisions d set consumed=true
    from public.tflash_permission_grants g
    where d.owner_kind=p_kind and d.owner_id=p_owner and d.session_id=p_session
      and d.call_id=p_call and d.origin=p_origin and not d.consumed and d.epoch_revision=epoch
      and g.owner_kind=d.owner_kind and g.owner_id=d.owner_id and g.session_id=d.session_id
      and g.origin=d.origin and g.revision=d.grant_revision and g.expires_at > now();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
