-- =============================================================================
-- 0800 — Row Level Security
--
-- Philosophy: DENY unless explicitly allowed. RLS is enabled on every table in
-- the exposed `public` schema. No policy relies on `TO authenticated` alone and
-- none reads user-editable JWT metadata — membership and ownership are always
-- checked against real rows through the trusted helpers in `app`.
-- =============================================================================

-- RLS is enabled (not FORCEd) so that the SECURITY DEFINER helpers in `app`,
-- owned by the migration role, can read membership rows without recursing into
-- the very policies that call them. `anon` and `authenticated` are always
-- subject to the policies below; `service_role` carries BYPASSRLS and is only
-- ever used from server-side code that has already authorized the caller.
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Privilege escalation via `is_platform_admin` is blocked by the
-- app.guard_profile_privileges() trigger, not by this policy.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- tournaments
-- -----------------------------------------------------------------------------
drop policy if exists tournaments_select_public on public.tournaments;
create policy tournaments_select_public on public.tournaments
  for select to anon, authenticated
  using (visibility = 'public' and status <> 'draft');

drop policy if exists tournaments_select_member on public.tournaments;
create policy tournaments_select_member on public.tournaments
  for select to authenticated
  using (app.is_tournament_member(id));

drop policy if exists tournaments_insert_admin on public.tournaments;
create policy tournaments_insert_admin on public.tournaments
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'draft' and player_count = 0);

drop policy if exists tournaments_update_admin on public.tournaments;
create policy tournaments_update_admin on public.tournaments
  for update to authenticated
  using (app.is_tournament_admin(id))
  with check (app.is_tournament_admin(id));

drop policy if exists tournaments_delete_owner on public.tournaments;
create policy tournaments_delete_owner on public.tournaments
  for delete to authenticated
  using (created_by = auth.uid() and status = 'draft');

-- -----------------------------------------------------------------------------
-- tournament_admins
-- -----------------------------------------------------------------------------
drop policy if exists tournament_admins_select on public.tournament_admins;
create policy tournament_admins_select on public.tournament_admins
  for select to anon, authenticated
  using (app.can_view_tournament(tournament_id));

drop policy if exists tournament_admins_write on public.tournament_admins;
create policy tournament_admins_write on public.tournament_admins
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- tournament_rules
-- -----------------------------------------------------------------------------
drop policy if exists tournament_rules_select on public.tournament_rules;
create policy tournament_rules_select on public.tournament_rules
  for select to anon, authenticated
  using (app.can_view_tournament(tournament_id));

drop policy if exists tournament_rules_write on public.tournament_rules;
create policy tournament_rules_write on public.tournament_rules
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- tournament_players
--
-- Players never insert their own row: public.join_tournament() does, under the
-- capacity lock. Self-approval is impossible because no player-facing policy
-- allows an UPDATE at all.
-- -----------------------------------------------------------------------------
drop policy if exists tournament_players_select on public.tournament_players;
create policy tournament_players_select on public.tournament_players
  for select to anon, authenticated
  using (app.can_view_tournament(tournament_id) or user_id = auth.uid());

drop policy if exists tournament_players_admin_write on public.tournament_players;
create policy tournament_players_admin_write on public.tournament_players
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- tournament_invites — the token is a secret. Admins only, never players.
-- -----------------------------------------------------------------------------
drop policy if exists tournament_invites_admin on public.tournament_invites;
create policy tournament_invites_admin on public.tournament_invites
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id) and created_by = auth.uid());

drop policy if exists invite_redemptions_select on public.invite_redemptions;
create policy invite_redemptions_select on public.invite_redemptions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tournament_invites i
      where i.id = invite_id and app.is_tournament_admin(i.tournament_id)
    )
  );

-- -----------------------------------------------------------------------------
-- tournament_waitlist
-- -----------------------------------------------------------------------------
drop policy if exists waitlist_select on public.tournament_waitlist;
create policy waitlist_select on public.tournament_waitlist
  for select to authenticated
  using (user_id = auth.uid() or app.is_tournament_admin(tournament_id));

drop policy if exists waitlist_admin_write on public.tournament_waitlist;
create policy waitlist_admin_write on public.tournament_waitlist
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- audit_logs — readable by admins, writable by nobody through PostgREST.
-- -----------------------------------------------------------------------------
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (tournament_id is not null and app.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- Competition state — public read, admin-free write. Only trusted server code
-- (service role) writes fixtures, ties, scores and standings.
-- -----------------------------------------------------------------------------
drop policy if exists league_rounds_select on public.league_rounds;
create policy league_rounds_select on public.league_rounds
  for select to anon, authenticated using (app.can_view_tournament(tournament_id));

drop policy if exists draws_select on public.draws;
create policy draws_select on public.draws
  for select to anon, authenticated using (app.can_view_tournament(tournament_id));

drop policy if exists draw_entries_select on public.draw_entries;
create policy draw_entries_select on public.draw_entries
  for select to anon, authenticated
  using (exists (
    select 1 from public.draws d
    where d.id = draw_id and app.can_view_tournament(d.tournament_id) and d.revealed_at is not null
  ));

drop policy if exists knockout_ties_select on public.knockout_ties;
create policy knockout_ties_select on public.knockout_ties
  for select to anon, authenticated using (app.can_view_tournament(tournament_id));

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to anon, authenticated using (app.can_view_tournament(tournament_id));

drop policy if exists standings_snapshots_select on public.standings_snapshots;
create policy standings_snapshots_select on public.standings_snapshots
  for select to anon, authenticated using (app.can_view_tournament(tournament_id));

drop policy if exists tournament_activity_select on public.tournament_activity;
create policy tournament_activity_select on public.tournament_activity
  for select to anon, authenticated using (app.can_view_tournament(tournament_id));

-- -----------------------------------------------------------------------------
-- Evidence
-- -----------------------------------------------------------------------------
drop policy if exists match_submissions_select on public.match_submissions;
create policy match_submissions_select on public.match_submissions
  for select to anon, authenticated
  using (app.can_view_tournament(app.match_tournament(match_id)));

drop policy if exists match_evidence_select on public.match_evidence;
create policy match_evidence_select on public.match_evidence
  for select to anon, authenticated
  using (app.can_view_tournament(app.match_tournament(match_id)));

-- A participant may insert evidence for their own match, once, as themselves.
-- There is deliberately no UPDATE or DELETE policy: evidence is immutable.
drop policy if exists match_evidence_insert_participant on public.match_evidence;
create policy match_evidence_insert_participant on public.match_evidence
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and app.is_match_participant(match_id)
  );

drop policy if exists ai_extractions_select on public.ai_extractions;
create policy ai_extractions_select on public.ai_extractions
  for select to anon, authenticated
  using (app.can_view_tournament(app.match_tournament(match_id)));

drop policy if exists verification_runs_select on public.verification_runs;
create policy verification_runs_select on public.verification_runs
  for select to authenticated
  using (app.is_tournament_admin(app.match_tournament(match_id))
         or app.is_match_participant(match_id));

drop policy if exists verification_cases_select on public.verification_cases;
create policy verification_cases_select on public.verification_cases
  for select to anon, authenticated
  using (app.can_view_tournament(tournament_id));

drop policy if exists verification_cases_admin on public.verification_cases;
create policy verification_cases_admin on public.verification_cases
  for update to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

drop policy if exists correction_requests_select on public.evidence_correction_requests;
create policy correction_requests_select on public.evidence_correction_requests
  for select to authenticated
  using (requested_by = auth.uid()
         or app.is_tournament_admin(app.match_tournament(match_id)));

drop policy if exists correction_requests_insert on public.evidence_correction_requests;
create policy correction_requests_insert on public.evidence_correction_requests
  for insert to authenticated
  with check (requested_by = auth.uid()
              and app.is_match_participant(match_id)
              and status = 'pending');

drop policy if exists correction_requests_admin on public.evidence_correction_requests;
create policy correction_requests_admin on public.evidence_correction_requests
  for update to authenticated
  using (app.is_tournament_admin(app.match_tournament(match_id)))
  with check (app.is_tournament_admin(app.match_tournament(match_id)));

-- -----------------------------------------------------------------------------
-- News
-- -----------------------------------------------------------------------------
drop policy if exists news_select_published on public.news_posts;
create policy news_select_published on public.news_posts
  for select to anon, authenticated
  using (status = 'published' and app.can_view_tournament(tournament_id));

drop policy if exists news_select_own_or_admin on public.news_posts;
create policy news_select_own_or_admin on public.news_posts
  for select to authenticated
  using (author_id = auth.uid() or app.is_tournament_admin(tournament_id));

-- A player post is authored by the requester, is labelled PLAYER_POST, is
-- published immediately and can never claim to be an AI or system story.
drop policy if exists news_insert_player on public.news_posts;
create policy news_insert_player on public.news_posts
  for insert to authenticated
  with check (
    source = 'player'
    and author_id = auth.uid()
    and label = 'PLAYER_POST'
    and status = 'published'
    and source_match_id is null
    and event_key is null
    and pinned = false
    and app.is_tournament_member(tournament_id)
  );

drop policy if exists news_update_own on public.news_posts;
create policy news_update_own on public.news_posts
  for update to authenticated
  using (author_id = auth.uid() and source = 'player' and status = 'published')
  with check (author_id = auth.uid() and source = 'player'
              and label = 'PLAYER_POST' and pinned = false and status = 'published');

drop policy if exists news_delete_own on public.news_posts;
create policy news_delete_own on public.news_posts
  for delete to authenticated
  using (author_id = auth.uid() and source = 'player');

drop policy if exists news_admin_all on public.news_posts;
create policy news_admin_all on public.news_posts
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

drop policy if exists news_media_select on public.news_post_media;
create policy news_media_select on public.news_post_media
  for select to anon, authenticated
  using (exists (select 1 from public.news_posts p where p.id = post_id));

drop policy if exists news_media_write on public.news_post_media;
create policy news_media_write on public.news_post_media
  for all to authenticated
  using (exists (select 1 from public.news_posts p
                 where p.id = post_id
                   and (p.author_id = auth.uid() or app.is_tournament_admin(p.tournament_id))))
  with check (exists (select 1 from public.news_posts p
                      where p.id = post_id
                        and (p.author_id = auth.uid() or app.is_tournament_admin(p.tournament_id))));

drop policy if exists news_reactions_select on public.news_reactions;
create policy news_reactions_select on public.news_reactions
  for select to anon, authenticated
  using (exists (select 1 from public.news_posts p where p.id = post_id));

drop policy if exists news_reactions_own on public.news_reactions;
create policy news_reactions_own on public.news_reactions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and exists (select 1 from public.news_posts p
                          where p.id = post_id and app.is_tournament_member(p.tournament_id)));

drop policy if exists news_reports_insert on public.news_reports;
create policy news_reports_insert on public.news_reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists news_reports_select on public.news_reports;
create policy news_reports_select on public.news_reports
  for select to authenticated
  using (reporter_id = auth.uid()
         or exists (select 1 from public.news_posts p
                    where p.id = post_id and app.is_tournament_admin(p.tournament_id)));

-- -----------------------------------------------------------------------------
-- Chat
--
-- Membership in chat_room_members is the single gate. A user who guesses a
-- room_id or conversation id gains nothing: every policy joins back to their own
-- membership row.
-- -----------------------------------------------------------------------------
drop policy if exists chat_rooms_select_member on public.chat_rooms;
create policy chat_rooms_select_member on public.chat_rooms
  for select to authenticated using (app.is_chat_member(id));

drop policy if exists chat_members_select on public.chat_room_members;
create policy chat_members_select on public.chat_room_members
  for select to authenticated using (app.is_chat_member(room_id));

drop policy if exists chat_members_admin on public.chat_room_members;
create policy chat_members_admin on public.chat_room_members
  for all to authenticated
  using (app.chat_room_tournament(room_id) is not null
         and app.is_tournament_admin(app.chat_room_tournament(room_id)))
  with check (app.chat_room_tournament(room_id) is not null
              and app.is_tournament_admin(app.chat_room_tournament(room_id)));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated using (app.is_chat_member(room_id));

-- kind = 'user' AND sender_id = auth.uid() makes a forged system message
-- impossible: the CHECK constraint forbids a system row with a sender, and this
-- policy forbids any insert without one.
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and kind = 'user'
    and system_event is null
    and pinned = false
    and deleted_at is null
    and app.is_chat_member(room_id)
    and not app.is_chat_muted(room_id)
  );

drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid() and kind = 'user' and pinned = false);

-- Tournament admins moderate (delete / pin) messages in their own group. The
-- app.guard_chat_message_update() trigger keeps any UPDATE from flipping a user
-- message into a trusted system message.
drop policy if exists chat_messages_admin on public.chat_messages;
create policy chat_messages_admin on public.chat_messages
  for update to authenticated
  using (app.chat_room_tournament(room_id) is not null
         and app.is_tournament_admin(app.chat_room_tournament(room_id)))
  with check (app.chat_room_tournament(room_id) is not null
              and app.is_tournament_admin(app.chat_room_tournament(room_id)));

drop policy if exists chat_attachments_select on public.chat_message_attachments;
create policy chat_attachments_select on public.chat_message_attachments
  for select to authenticated using (app.is_chat_member(room_id));

drop policy if exists chat_attachments_insert on public.chat_message_attachments;
create policy chat_attachments_insert on public.chat_message_attachments
  for insert to authenticated
  with check (
    app.is_chat_member(room_id)
    and exists (select 1 from public.chat_messages m
                where m.id = message_id and m.room_id = room_id and m.sender_id = auth.uid())
  );

drop policy if exists chat_attachments_admin_delete on public.chat_message_attachments;
create policy chat_attachments_admin_delete on public.chat_message_attachments
  for delete to authenticated
  using (
    exists (select 1 from public.chat_messages m
            where m.id = message_id and m.sender_id = auth.uid())
    or (app.chat_room_tournament(room_id) is not null
        and app.is_tournament_admin(app.chat_room_tournament(room_id)))
  );

drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions
  for select to authenticated
  using (exists (select 1 from public.chat_messages m
                 where m.id = message_id and app.is_chat_member(m.room_id)));

drop policy if exists chat_reactions_own on public.chat_reactions;
create policy chat_reactions_own on public.chat_reactions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and exists (select 1 from public.chat_messages m
                          where m.id = message_id and app.is_chat_member(m.room_id)));

drop policy if exists chat_read_state_own on public.chat_read_state;
create policy chat_read_state_own on public.chat_read_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and app.is_chat_member(room_id));

drop policy if exists chat_mutes_select on public.chat_mutes;
create policy chat_mutes_select on public.chat_mutes
  for select to authenticated
  using (user_id = auth.uid()
         or (app.chat_room_tournament(room_id) is not null
             and app.is_tournament_admin(app.chat_room_tournament(room_id))));

drop policy if exists chat_mutes_admin on public.chat_mutes;
create policy chat_mutes_admin on public.chat_mutes
  for all to authenticated
  using (app.chat_room_tournament(room_id) is not null
         and app.is_tournament_admin(app.chat_room_tournament(room_id)))
  with check (app.chat_room_tournament(room_id) is not null
              and app.is_tournament_admin(app.chat_room_tournament(room_id)));

drop policy if exists player_blocks_own on public.player_blocks;
create policy player_blocks_own on public.player_blocks
  for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_own_delete on public.notifications;
create policy notifications_own_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Telegram — the bot token, chat ids and outbox never reach a browser.
-- -----------------------------------------------------------------------------
drop policy if exists telegram_connections_own on public.telegram_connections;
create policy telegram_connections_own on public.telegram_connections
  for select to authenticated using (user_id = auth.uid());

drop policy if exists telegram_connections_revoke on public.telegram_connections;
create policy telegram_connections_revoke on public.telegram_connections
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- telegram_outbox and telegram_updates deliberately carry no policies at all:
-- with RLS enabled and no policy, every non-service role reads and writes
-- nothing.

-- -----------------------------------------------------------------------------
-- Moderation
-- -----------------------------------------------------------------------------
drop policy if exists moderation_insert on public.moderation_reports;
create policy moderation_insert on public.moderation_reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists moderation_select on public.moderation_reports;
create policy moderation_select on public.moderation_reports
  for select to authenticated
  using (reporter_id = auth.uid()
         or (tournament_id is not null and app.is_tournament_admin(tournament_id)));

drop policy if exists moderation_admin_update on public.moderation_reports;
create policy moderation_admin_update on public.moderation_reports
  for update to authenticated
  using (tournament_id is not null and app.is_tournament_admin(tournament_id))
  with check (tournament_id is not null and app.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- Grants. PostgREST roles get table privileges; RLS then narrows them to rows.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;

-- Nothing may write these through the API under any circumstances.
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.matches from anon, authenticated;
revoke insert, update, delete on public.knockout_ties from anon, authenticated;
revoke insert, update, delete on public.league_rounds from anon, authenticated;
revoke insert, update, delete on public.standings_snapshots from anon, authenticated;
revoke insert, update, delete on public.draws from anon, authenticated;
revoke insert, update, delete on public.draw_entries from anon, authenticated;
revoke insert, update, delete on public.ai_extractions from anon, authenticated;
revoke insert, update, delete on public.verification_runs from anon, authenticated;
revoke insert, delete on public.verification_cases from anon, authenticated;
revoke insert, update, delete on public.tournament_activity from anon, authenticated;
revoke insert, update, delete on public.telegram_outbox from anon, authenticated;
revoke insert, update, delete on public.telegram_updates from anon, authenticated;
revoke insert, delete on public.telegram_connections from anon, authenticated;
revoke insert, update, delete on public.invite_redemptions from anon, authenticated;
revoke update, delete on public.match_evidence from anon, authenticated;
revoke insert, update, delete on public.match_submissions from anon, authenticated;
revoke insert, update, delete on public.chat_rooms from anon, authenticated;
revoke all on public.tournament_invites from anon;

alter default privileges in schema public
  grant select on tables to anon, authenticated;
