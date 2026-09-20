-- =============================================================================
-- 1000 — Realtime
--
-- Only tables whose SELECT policies already restrict rows to the right audience
-- are published. Realtime applies the same RLS on postgres_changes streams, so a
-- subscriber receives exactly the rows they could have queried.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'matches',
    'knockout_ties',
    'tournaments',
    'tournament_players',
    'tournament_activity',
    'news_posts',
    'chat_messages',
    'chat_reactions',
    'chat_read_state',
    'notifications',
    'verification_cases',
    'draws',
    'draw_entries',
    'match_evidence'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Realtime needs the full previous row to evaluate RLS on UPDATE/DELETE events
-- for tables whose policies reference columns other than the primary key.
alter table public.chat_messages replica identity full;
alter table public.matches replica identity full;
alter table public.notifications replica identity full;

-- -----------------------------------------------------------------------------
-- Realtime Authorization for private channels (broadcast / presence).
--
-- Channel naming convention:
--   tournament:<tournament_id>   — participants and admins
--   room:<chat_room_id>          — members of that chat room only
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;

  execute 'alter table realtime.messages enable row level security';

  execute 'drop policy if exists realtime_private_read on realtime.messages';
  execute $p$
    create policy realtime_private_read on realtime.messages
      for select to authenticated
      using (
        (
          realtime.topic() like 'room:%'
          and app.is_chat_member(substring(realtime.topic() from 6)::uuid)
        )
        or (
          realtime.topic() like 'tournament:%'
          and app.is_tournament_member(substring(realtime.topic() from 12)::uuid)
        )
      )
  $p$;

  execute 'drop policy if exists realtime_private_write on realtime.messages';
  execute $p$
    create policy realtime_private_write on realtime.messages
      for insert to authenticated
      with check (
        (
          realtime.topic() like 'room:%'
          and app.is_chat_member(substring(realtime.topic() from 6)::uuid)
          and not app.is_chat_muted(substring(realtime.topic() from 6)::uuid)
        )
        or (
          realtime.topic() like 'tournament:%'
          and app.is_tournament_member(substring(realtime.topic() from 12)::uuid)
        )
      )
  $p$;
exception
  when insufficient_privilege then
    raise notice 'realtime.messages policies skipped: insufficient privilege';
end $$;
