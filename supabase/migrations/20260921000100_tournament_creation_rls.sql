-- =============================================================================
-- 2026-09-21 — Tournament creation through authenticated RLS
--
-- INSERT ... RETURNING must be able to read the row it just created. The
-- creator therefore receives immediate SELECT access even before bootstrap
-- membership is observed by PostgREST. Creation itself remains draft-only.
-- =============================================================================

drop policy if exists tournaments_select_member on public.tournaments;
create policy tournaments_select_member on public.tournaments
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or app.is_tournament_member(id)
  );

drop policy if exists tournaments_insert_admin on public.tournaments;
create policy tournaments_insert_admin on public.tournaments
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'draft'
    and player_count = 0
  );
