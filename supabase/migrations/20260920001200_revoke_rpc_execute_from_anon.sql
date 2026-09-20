-- =============================================================================
-- 1200 — Close the RPC surface to anonymous callers
--
-- Flagged by the Supabase security advisor. These four functions already return
-- UNAUTHENTICATED when auth.uid() is null, so this was never exploitable — but
-- Supabase's default privileges grant EXECUTE to `anon` explicitly, which
-- `revoke ... from public` does not undo. A signed-out caller should not be able
-- to reach a SECURITY DEFINER function at all, so the grant is removed rather
-- than merely neutralised inside the function body.
-- =============================================================================

revoke execute on function public.join_tournament(uuid, text) from anon;
revoke execute on function public.check_in_tournament(uuid) from anon;
revoke execute on function public.open_direct_room(uuid) from anon;
revoke execute on function public.mark_room_read(uuid, uuid) from anon;

-- Keep the service-role-only functions closed to both API roles.
revoke execute on function public.apply_official_result(
  uuid, smallint, smallint, text, uuid, text, smallint, smallint, smallint, smallint
) from anon, authenticated;
revoke execute on function public.post_system_message(uuid, text, text) from anon, authenticated;

-- New functions must not be granted to the API roles by default either.
alter default privileges in schema public revoke execute on functions from anon;
