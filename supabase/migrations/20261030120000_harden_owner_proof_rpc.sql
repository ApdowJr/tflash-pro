-- Production drifted from the committed migrations: `owner_proof_hash`,
-- its fill trigger, and `tflash_verify_owner_proof(text, text)` were added
-- directly to the project. The app does not call this RPC; the Next.js and Eve
-- servers verify the signed owner proof with `verifyChatOwnership`. The
-- function is SECURITY DEFINER, so allowing clients to execute it exposes an
-- RLS-bypassing check with no product need.
--
-- Keep the function for the database owner but remove client execution. This
-- is a no-op on a project that never had the out-of-band function.
do $$
begin
  if to_regprocedure('public.tflash_verify_owner_proof(text,text)') is not null then
    revoke all on function public.tflash_verify_owner_proof(text, text)
      from public, anon, authenticated;
  end if;
end
$$;

-- Index decision (2026-10-30): keep all three advisor-listed indexes for now:
--   tflash_chats_user_updated_full_idx
--   tflash_messages_session_created_idx
--   tflash_messages_user_created_idx
-- They are reported unused because the workload is small and the messages
-- table is empty. Dropping them now would be an unmeasured change. This
-- migration intentionally drops no index.
