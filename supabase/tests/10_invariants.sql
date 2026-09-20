-- =============================================================================
-- SQL invariant assertions
--
-- These verify the guarantees that live in the database itself — the ones no
-- amount of application code can provide and no client can talk its way past.
-- Run by scripts/verify-sql.sh against a throwaway database.
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
create or replace function pg_temp.mk_user(p_name text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into auth.users (instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_name || '-' || extensions.gen_random_uuid() || '@test.invalid', '', now(),
          jsonb_build_object('display_name', p_name))
  returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
                     false);
end $$;

create or replace function pg_temp.act_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
end $$;

-- =============================================================================
-- 1. Capacity is a hard database ceiling
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('owner');
  v_t uuid;
  v_players uuid[];
  v_i int;
  v_failed boolean := false;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status, visibility)
  values ('cap-8', 'Capacity 8', 8, v_owner, 'registration_open', 'public')
  returning id into v_t;

  for v_i in 1..9 loop
    v_players := v_players || pg_temp.mk_user('cap' || v_i);
  end loop;

  for v_i in 1..8 loop
    insert into public.tournament_players (tournament_id, user_id, status)
    values (v_t, v_players[v_i], 'approved');
  end loop;

  assert (select player_count from public.tournaments where id = v_t) = 8,
    'player_count must track occupancy exactly';

  begin
    insert into public.tournament_players (tournament_id, user_id, status)
    values (v_t, v_players[9], 'approved');
  exception when check_violation then
    v_failed := true;
  end;

  assert v_failed, 'the 9th player in an 8-player tournament MUST be rejected';
  assert (select player_count from public.tournaments where id = v_t) = 8,
    'a rejected join must not move the count';

  -- Freeing a slot makes room again, without drift.
  update public.tournament_players set status = 'withdrawn'
   where tournament_id = v_t and user_id = v_players[1];
  assert (select player_count from public.tournaments where id = v_t) = 7,
    'withdrawing must free exactly one slot';

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_players[9], 'approved');
  assert (select player_count from public.tournaments where id = v_t) = 8,
    'the freed slot must be reusable';

  raise notice 'OK  capacity ceiling (8/16) is enforced by the database';
end $$;

do $$
declare
  v_owner uuid := pg_temp.mk_user('owner16');
  v_t uuid;
  v_ok boolean := false;
begin
  -- Only 8 and 16 are legal capacities.
  begin
    insert into public.tournaments (slug, name, capacity, created_by)
    values ('cap-12', 'Capacity 12', 12, v_owner);
  exception when check_violation then
    v_ok := true;
  end;
  assert v_ok, 'capacity must be constrained to 8 or 16';
  raise notice 'OK  capacity values are constrained to 8 and 16';
end $$;

-- =============================================================================
-- 2. Tournament state machine
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('sm');
  v_t uuid;
  v_blocked boolean := false;
begin
  insert into public.tournaments (slug, name, capacity, created_by)
  values ('state-machine', 'State', 8, v_owner)
  returning id into v_t;

  begin
    update public.tournaments set status = 'completed' where id = v_t;
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'draft -> completed must be rejected';

  update public.tournaments set status = 'registration_open' where id = v_t;
  assert (select status from public.tournaments where id = v_t) = 'registration_open',
    'a legal transition must succeed';

  raise notice 'OK  illegal tournament state transitions are rejected';
end $$;

-- =============================================================================
-- 3. Evidence and audit immutability
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('imm');
  v_a uuid := pg_temp.mk_user('imm-a');
  v_b uuid := pg_temp.mk_user('imm-b');
  v_t uuid;
  v_match uuid;
  v_sub uuid;
  v_ev uuid;
  v_blocked boolean;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status)
  values ('immutable', 'Immutable', 8, v_owner, 'registration_open')
  returning id into v_t;

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_a, 'approved'), (v_t, v_b, 'approved');

  insert into public.matches (tournament_id, stage, round_number, player_a, player_b, status)
  values (v_t, 'league', 1, v_a, v_b, 'ready')
  returning id into v_match;

  insert into public.match_submissions (match_id, user_id) values (v_match, v_a)
  returning id into v_sub;

  insert into public.match_evidence (match_id, submission_id, uploaded_by, storage_path,
                                     file_hash, mime_type, byte_size)
  values (v_match, v_sub, v_a, v_t || '/' || v_match || '/' || v_a || '/a.jpg',
          repeat('a', 64), 'image/jpeg', 1024)
  returning id into v_ev;

  -- A single screenshot moves the match to "awaiting the second party".
  assert (select status from public.matches where id = v_match) = 'awaiting_second_evidence',
    'first evidence must park the match awaiting the opponent';

  v_blocked := false;
  begin
    update public.match_evidence set storage_path = 'tampered' where id = v_ev;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'evidence storage_path must be immutable';

  v_blocked := false;
  begin
    delete from public.match_evidence where id = v_ev;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'evidence must not be deletable';

  v_blocked := false;
  begin
    update public.audit_logs set action = 'FORGED' where tournament_id = v_t;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'audit log rows must be immutable';

  v_blocked := false;
  begin
    delete from public.audit_logs where tournament_id = v_t;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'audit log rows must not be deletable';

  -- A non-participant cannot have evidence recorded against the match.
  v_blocked := false;
  begin
    insert into public.match_evidence (match_id, submission_id, uploaded_by, storage_path,
                                       file_hash, mime_type, byte_size)
    values (v_match, v_sub, v_owner, 'x/y/z/c.jpg', repeat('c', 64), 'image/jpeg', 10);
  exception when others then v_blocked := true; end;
  assert v_blocked, 'evidence from a non-participant must be rejected';

  raise notice 'OK  evidence and audit logs are immutable';
end $$;

-- =============================================================================
-- 4. Official result application
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('res');
  v_a uuid := pg_temp.mk_user('res-a');
  v_b uuid := pg_temp.mk_user('res-b');
  v_t uuid;
  v_tie uuid;
  v_leg1 uuid;
  v_leg2 uuid;
  v_result jsonb;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status)
  values ('aggregate', 'Aggregate', 8, v_owner, 'registration_open')
  returning id into v_t;

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_a, 'approved'), (v_t, v_b, 'approved');

  insert into public.knockout_ties (tournament_id, stage, position, player_a, player_b,
                                    two_legs, status)
  values (v_t, 'playoff', 1, v_a, v_b, true, 'first_leg')
  returning id into v_tie;

  insert into public.matches (tournament_id, stage, tie_id, leg, player_a, player_b, status)
  values (v_t, 'playoff', v_tie, 1, v_a, v_b, 'ready') returning id into v_leg1;
  insert into public.matches (tournament_id, stage, tie_id, leg, player_a, player_b, status)
  values (v_t, 'playoff', v_tie, 2, v_b, v_a, 'pending') returning id into v_leg2;

  -- §19 worked example: 2–1 then 3–1 the other way → 4–3 on aggregate.
  v_result := public.apply_official_result(v_leg1, 2::smallint, 1::smallint, 'ai_verified');
  assert (v_result ->> 'ok')::boolean, 'first leg must apply';
  assert (v_result ->> 'tie_completed')::boolean is false,
    'a first leg must never decide the tie';

  v_result := public.apply_official_result(v_leg2, 3::smallint, 1::smallint, 'ai_verified');
  assert (v_result ->> 'ok')::boolean, 'second leg must apply';
  assert (v_result ->> 'tie_completed')::boolean, 'the tie must be decided after the second leg';
  assert (v_result ->> 'tie_winner')::uuid = v_b, 'the aggregate winner must advance';

  assert (select aggregate_a from public.knockout_ties where id = v_tie) = 3,
    'aggregate must be recomputed from the verified legs';
  assert (select aggregate_b from public.knockout_ties where id = v_tie) = 4,
    'aggregate must be recomputed from the verified legs';
  assert (select status from public.matches where id = v_leg1) = 'verified',
    'an applied result must mark the match verified';

  raise notice 'OK  aggregate, advancement and verification state are correct';
end $$;

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('rls-owner');
  v_p1 uuid := pg_temp.mk_user('rls-p1');
  v_p2 uuid := pg_temp.mk_user('rls-p2');
  v_outsider uuid := pg_temp.mk_user('rls-outsider');
  v_t uuid;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status, visibility)
  values ('rls-demo', 'RLS', 8, v_owner, 'registration_open', 'public')
  returning id into v_t;

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_p1, 'approved'), (v_t, v_p2, 'approved');

  perform set_config('efootball.test_t', v_t::text, false);
  perform set_config('efootball.test_p1', v_p1::text, false);
  perform set_config('efootball.test_p2', v_p2::text, false);
  perform set_config('efootball.test_outsider', v_outsider::text, false);
  perform set_config('efootball.test_owner', v_owner::text, false);
end $$;

-- 5a. The tournament group chat is closed to non-members.
set role authenticated;
select pg_temp.act_as(current_setting('efootball.test_p1')::uuid);

do $$
declare v_room uuid; v_count int;
begin
  select id into v_room from public.chat_rooms
   where tournament_id = current_setting('efootball.test_t')::uuid
     and type = 'tournament_group';
  assert v_room is not null, 'a participant must see the tournament group';

  insert into public.chat_messages (room_id, sender_id, kind, body)
  values (v_room, current_setting('efootball.test_p1')::uuid, 'user', 'مرحبا');

  select count(*) into v_count from public.chat_messages where room_id = v_room;
  assert v_count >= 1, 'a participant must read the group they belong to';

  perform set_config('efootball.test_room', v_room::text, false);
  raise notice 'OK  a tournament participant can read and post in the group';
end $$;

select pg_temp.act_as(current_setting('efootball.test_outsider')::uuid);

do $$
declare v_count int; v_blocked boolean := false;
begin
  -- Knowing the room id buys an outsider nothing.
  select count(*) into v_count from public.chat_rooms
   where id = current_setting('efootball.test_room')::uuid;
  assert v_count = 0, 'ACCESS DENIED: an outsider must not see the group room';

  select count(*) into v_count from public.chat_messages
   where room_id = current_setting('efootball.test_room')::uuid;
  assert v_count = 0, 'ACCESS DENIED: an outsider must not read group messages';

  begin
    insert into public.chat_messages (room_id, sender_id, kind, body)
    values (current_setting('efootball.test_room')::uuid,
            current_setting('efootball.test_outsider')::uuid, 'user', 'intrusion');
  exception when others then v_blocked := true; end;
  assert v_blocked, 'ACCESS DENIED: an outsider must not post to the group';

  raise notice 'OK  an unrelated authenticated user is denied the tournament group';
end $$;

-- 5b. A player cannot forge a trusted system message.
select pg_temp.act_as(current_setting('efootball.test_p1')::uuid);

do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.chat_messages (room_id, sender_id, kind, body, system_event)
    values (current_setting('efootball.test_room')::uuid, null, 'system',
            'النتيجة الرسمية 9-0', 'match_verified');
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to post a system message';

  v_blocked := false;
  begin
    -- Even claiming authorship of a "system" row must fail.
    insert into public.chat_messages (room_id, sender_id, kind, body)
    values (current_setting('efootball.test_room')::uuid,
            current_setting('efootball.test_p2')::uuid, 'user', 'impersonation');
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to post as another player';

  raise notice 'OK  system messages and impersonation cannot be forged';
end $$;

-- 5c. A player cannot write official competition state.
--
-- A write can be stopped two ways: a revoked table privilege or a failing
-- WITH CHECK raises, while a USING clause that matches no row silently updates
-- nothing. Both are a successful denial, so each case asserts that the row is
-- unchanged as well as that nothing was written.
do $$
declare
  v_blocked boolean;
  v_rows int;
  v_before int;
begin
  -- Official score
  select count(*) into v_before from public.matches
   where tournament_id = current_setting('efootball.test_t')::uuid and score_a = 9;
  v_blocked := false;
  begin
    update public.matches set score_a = 9, score_b = 0
     where tournament_id = current_setting('efootball.test_t')::uuid;
    get diagnostics v_rows = row_count;
    v_blocked := v_rows = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to write an official score';

  -- Standings
  v_blocked := false;
  begin
    insert into public.standings_snapshots (tournament_id, table_state)
    values (current_setting('efootball.test_t')::uuid, '{}'::jsonb);
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to write standings';

  -- Official draw
  v_blocked := false;
  begin
    insert into public.draws (tournament_id, kind, seed_hash, executed_by)
    values (current_setting('efootball.test_t')::uuid, 'playoff', 'x',
            current_setting('efootball.test_p1')::uuid);
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to run the official draw';

  -- Self-approval
  v_blocked := false;
  begin
    update public.tournament_players set status = 'approved'
     where tournament_id = current_setting('efootball.test_t')::uuid;
    get diagnostics v_rows = row_count;
    v_blocked := v_rows = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to approve themselves';

  -- Tournament rules
  v_blocked := false;
  begin
    update public.tournament_rules set points_win = 99
     where tournament_id = current_setting('efootball.test_t')::uuid;
    get diagnostics v_rows = row_count;
    v_blocked := v_rows = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a non-admin must not be able to edit tournament rules';

  -- Tournament state
  v_blocked := false;
  begin
    update public.tournaments set status = 'completed'
     where id = current_setting('efootball.test_t')::uuid;
    get diagnostics v_rows = row_count;
    v_blocked := v_rows = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to force the tournament state';

  -- Verification cases (dispute resolution)
  v_blocked := false;
  begin
    update public.verification_cases set status = 'resolved'
     where tournament_id = current_setting('efootball.test_t')::uuid;
    get diagnostics v_rows = row_count;
    v_blocked := v_rows = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a player must not be able to resolve a dispute';

  -- Confirm nothing actually landed.
  select count(*) into v_rows from public.matches
   where tournament_id = current_setting('efootball.test_t')::uuid and score_a = 9;
  assert v_rows = v_before, 'no official score may have been written';

  raise notice 'OK  players cannot write scores, standings, draws, approvals, rules or state';
end $$;

-- 5d. Privilege escalation and foreign profile edits.
do $$
declare v_blocked boolean := false; v_count int;
begin
  begin
    update public.profiles set is_platform_admin = true
     where id = current_setting('efootball.test_p1')::uuid;
    get diagnostics v_count = row_count;
    v_blocked := v_count = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a user must not be able to grant themselves platform admin';
  assert not (select is_platform_admin from public.profiles
               where id = current_setting('efootball.test_p1')::uuid),
    'the platform-admin flag must still be false';

  update public.profiles set display_name = 'hacked'
   where id = current_setting('efootball.test_p2')::uuid;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'a user must not be able to edit another profile';

  raise notice 'OK  privilege escalation and foreign profile edits are blocked';
end $$;

-- 5e. Invite tokens are not readable by players.
do $$
declare v_count int;
begin
  select count(*) into v_count from public.tournament_invites;
  assert v_count = 0, 'invite tokens must never be readable by a player';
  raise notice 'OK  invite secrets are invisible to players';
end $$;

-- 5f. Direct messages are visible only to their two participants.
reset role;

do $$
declare
  v_p1 uuid := current_setting('efootball.test_p1')::uuid;
  v_p2 uuid := current_setting('efootball.test_p2')::uuid;
  v_room uuid;
begin
  insert into public.chat_rooms (type, dm_key) values ('direct', app.dm_key(v_p1, v_p2))
  returning id into v_room;
  insert into public.chat_room_members (room_id, user_id) values (v_room, v_p1), (v_room, v_p2);
  insert into public.chat_messages (room_id, sender_id, kind, body)
  values (v_room, v_p1, 'user', 'سر بيننا');
  perform set_config('efootball.test_dm', v_room::text, false);
end $$;

set role authenticated;
select pg_temp.act_as(current_setting('efootball.test_p2')::uuid);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.chat_messages
   where room_id = current_setting('efootball.test_dm')::uuid;
  assert v_count = 1, 'a DM participant must read their own conversation';
  raise notice 'OK  a direct-message participant can read the conversation';
end $$;

select pg_temp.act_as(current_setting('efootball.test_outsider')::uuid);

do $$
declare v_count int;
begin
  -- Requesting the conversation id by hand yields nothing.
  select count(*) into v_count from public.chat_messages
   where room_id = current_setting('efootball.test_dm')::uuid;
  assert v_count = 0, 'ACCESS DENIED: a third player must not read a foreign DM';

  select count(*) into v_count from public.chat_rooms
   where id = current_setting('efootball.test_dm')::uuid;
  assert v_count = 0, 'ACCESS DENIED: a third player must not see a foreign DM room';

  select count(*) into v_count from public.chat_room_members
   where room_id = current_setting('efootball.test_dm')::uuid;
  assert v_count = 0, 'ACCESS DENIED: a third player must not enumerate DM members';

  raise notice 'OK  changing conversation_id never exposes another conversation';
end $$;

-- 5g. Anonymous visitors see public tournaments only.
select pg_temp.act_as_anon();
set role anon;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.chat_messages;
  assert v_count = 0, 'anonymous users must not read any chat';

  select count(*) into v_count from public.notifications;
  assert v_count = 0, 'anonymous users must not read notifications';

  select count(*) into v_count from public.telegram_connections;
  assert v_count = 0, 'anonymous users must not read Telegram connections';

  select count(*) into v_count from public.tournaments
   where slug = 'rls-demo';
  assert v_count = 1, 'a public tournament must be visible anonymously';

  raise notice 'OK  anonymous access is limited to public tournament data';
end $$;

reset role;
select set_config('request.jwt.claims', '', false);

-- =============================================================================
-- 6. Uniqueness guarantees
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('uniq');
  v_p uuid := pg_temp.mk_user('uniq-p');
  v_t uuid;
  v_blocked boolean;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status)
  values ('uniqueness', 'Uniqueness', 8, v_owner, 'registration_open')
  returning id into v_t;

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_p, 'approved');

  v_blocked := false;
  begin
    insert into public.tournament_players (tournament_id, user_id, status)
    values (v_t, v_p, 'approved');
  exception when unique_violation then v_blocked := true; end;
  assert v_blocked, 'duplicate tournament membership must be rejected';

  v_blocked := false;
  begin
    insert into public.tournaments (slug, name, capacity, created_by)
    values ('uniqueness', 'Duplicate slug', 8, v_owner);
  exception when unique_violation then v_blocked := true; end;
  assert v_blocked, 'duplicate tournament slugs must be rejected';

  -- One group chat per tournament, one direct room per unordered pair.
  v_blocked := false;
  begin
    insert into public.chat_rooms (type, tournament_id) values ('tournament_group', v_t);
  exception when unique_violation then v_blocked := true; end;
  assert v_blocked, 'a tournament must have exactly one group chat';

  v_blocked := false;
  begin
    insert into public.chat_rooms (type, dm_key) values ('direct', app.dm_key(v_owner, v_p));
    insert into public.chat_rooms (type, dm_key) values ('direct', app.dm_key(v_p, v_owner));
  exception when unique_violation then v_blocked := true; end;
  assert v_blocked, 'duplicate direct conversations must be rejected';

  raise notice 'OK  uniqueness constraints hold';
end $$;

-- =============================================================================
-- 7. Score sanity
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('score');
  v_a uuid := pg_temp.mk_user('score-a');
  v_b uuid := pg_temp.mk_user('score-b');
  v_t uuid;
  v_blocked boolean;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status)
  values ('scores', 'Scores', 8, v_owner, 'registration_open')
  returning id into v_t;

  v_blocked := false;
  begin
    insert into public.matches (tournament_id, stage, round_number, player_a, player_b,
                                score_a, score_b)
    values (v_t, 'league', 1, v_a, v_b, -1, 0);
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'negative scores must be rejected';

  v_blocked := false;
  begin
    insert into public.matches (tournament_id, stage, round_number, player_a, player_b)
    values (v_t, 'league', 1, v_a, v_a);
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'a player must not face themselves';

  raise notice 'OK  score and fixture sanity constraints hold';
end $$;

-- =============================================================================
-- 8. Immutability stops an erasure, not a cascade
-- =============================================================================
do $$
declare
  v_owner uuid := pg_temp.mk_user('casc');
  v_a uuid := pg_temp.mk_user('casc-a');
  v_b uuid := pg_temp.mk_user('casc-b');
  v_t uuid; v_match uuid; v_sub uuid; v_ev uuid; v_room uuid; v_msg uuid;
  v_blocked boolean;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status)
  values ('cascade', 'Cascade', 8, v_owner, 'registration_open')
  returning id into v_t;

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_a, 'approved'), (v_t, v_b, 'approved');

  insert into public.matches (tournament_id, stage, round_number, player_a, player_b, status)
  values (v_t, 'league', 1, v_a, v_b, 'ready') returning id into v_match;
  insert into public.match_submissions (match_id, user_id) values (v_match, v_a)
  returning id into v_sub;
  insert into public.match_evidence (match_id, submission_id, uploaded_by, storage_path,
                                     file_hash, mime_type, byte_size)
  values (v_match, v_sub, v_a, v_t || '/' || v_match || '/' || v_a || '/a.jpg',
          repeat('a', 64), 'image/jpeg', 1024)
  returning id into v_ev;

  -- A direct delete is still refused.
  v_blocked := false;
  begin delete from public.match_evidence where id = v_ev;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a direct evidence delete must still be refused';

  -- Deleting the tournament must cascade cleanly.
  delete from public.tournaments where id = v_t;
  assert not exists (select 1 from public.match_evidence where id = v_ev),
    'deleting a tournament must cascade through its evidence';

  -- Deleting an author anonymises their messages instead of blocking.
  insert into public.tournaments (slug, name, capacity, created_by, status)
  values ('cascade2', 'Cascade 2', 8, v_owner, 'registration_open')
  returning id into v_t;
  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_a, 'approved');
  select id into v_room from public.chat_rooms
   where tournament_id = v_t and type = 'tournament_group';
  insert into public.chat_messages (room_id, sender_id, kind, body)
  values (v_room, v_a, 'user', 'hello') returning id into v_msg;

  -- Reassigning authorship to a live user is still refused.
  v_blocked := false;
  begin update public.chat_messages set sender_id = v_b where id = v_msg;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'authorship must not be reassignable';

  -- Promoting a user message to a system message is still refused.
  v_blocked := false;
  begin update public.chat_messages set kind = 'system' where id = v_msg;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a user message must not become a system message';

  delete from public.tournament_players where tournament_id = v_t and user_id = v_a;
  delete from auth.users where id = v_a;
  assert (select sender_id from public.chat_messages where id = v_msg) is null,
    'a deleted author must leave an anonymised message behind';

  raise notice 'OK  immutability blocks erasure but allows parent cascades';
end $$;

-- =============================================================================
-- 9. Every exposed table has RLS enabled
-- =============================================================================
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  assert v_missing is null,
    format('every public table must have RLS enabled; missing on: %s', v_missing);

  raise notice 'OK  RLS is enabled on every table in the public schema';
end $$;

\echo '✓ all SQL invariants hold'
