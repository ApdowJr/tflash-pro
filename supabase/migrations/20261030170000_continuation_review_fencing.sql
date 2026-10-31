-- A review note is not proof of an external effect. Owners can retain an
-- unresolved attempt on hold without re-enabling automatic web permissions.
alter table public.tflash_task_continuation_attempts
  add column review_revision uuid not null default gen_random_uuid(),
  add column hold_note text check (hold_note is null or length(hold_note) between 10 and 1000),
  add column hold_at timestamptz;

create function public.tflash_hold_continuation(p_kind text,p_owner text,p_session text,p_attempt uuid,p_expected uuid,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_expected is null or p_note is null or length(btrim(p_note)) not between 10 and 1000 then return false; end if;
  update public.tflash_task_continuation_attempts
    set hold_note=btrim(p_note), hold_at=now(), review_revision=gen_random_uuid()
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and attempt_id=p_attempt
      and state in ('reserved','dispatching') and review_revision=p_expected;
  get diagnostics changed = row_count;
  return changed=1;
end $$;

-- Explicit human attestation, not proof of terminal state or reconciliation.
create function public.tflash_resolve_continuation(p_kind text,p_owner text,p_session text,p_attempt uuid,p_expected uuid,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_expected is null or p_note is null or length(btrim(p_note)) not between 10 and 1000 then return false; end if;
  update public.tflash_task_continuation_attempts
    set state='reviewed',reviewed_at=now(),review_note=btrim(p_note),review_revision=gen_random_uuid()
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and attempt_id=p_attempt
      and state in ('reserved','dispatching') and review_revision=p_expected;
  get diagnostics changed = row_count;
  return changed=1;
end $$;

-- A hold placed before begin prevents that reservation from dispatching. The
-- revision also changes at begin so stale tabs cannot resolve a state they
-- saw only as reserved after another tab began dispatching.
create or replace function public.tflash_begin_continuation(p_kind text,p_owner text,p_session text,p_attempt uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare task public.tflash_tracked_tasks%rowtype; changed integer;
begin
  select * into task from public.tflash_tracked_tasks where owner_kind=p_kind and owner_id=p_owner and session_id=p_session for update;
  if not found or task.state<>'awaiting_evidence' then return false; end if;
  update public.tflash_task_continuation_attempts set state='dispatching',review_revision=gen_random_uuid()
    where owner_kind=p_kind and owner_id=p_owner and session_id=p_session and attempt_id=p_attempt
      and state='reserved' and hold_at is null and task_revision=task.revision;
  get diagnostics changed = row_count;
  return changed=1;
end $$;
revoke all on function public.tflash_hold_continuation(text,text,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.tflash_resolve_continuation(text,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tflash_hold_continuation(text,text,text,uuid,uuid,text) to service_role;
grant execute on function public.tflash_resolve_continuation(text,text,text,uuid,uuid,text) to service_role;
-- Fail closed for stale application deployments that lack review fencing.
revoke execute on function public.tflash_review_continuation(text,text,text,uuid,text) from service_role;
