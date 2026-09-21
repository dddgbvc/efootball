-- =============================================================================
-- Player Portal — security assertions
--
-- Every claim the portal makes about what a player can and cannot reach is
-- tested here against real policies, as the player's own role. A test that
-- passes because the query ran as the table owner would prove nothing, so each
-- block runs under `set role authenticated` with the player's claims set.
-- =============================================================================

\set ON_ERROR_STOP on

reset role;

-- Each file runs in its own psql session, so pg_temp helpers do not carry over.
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

-- -----------------------------------------------------------------------------
-- Fixture: one league tournament, four players, two rounds already scheduled.
-- A's round 1 is unplayed, so A's round 2 must be invisible to A.
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner uuid := pg_temp.mk_user('pp-owner');
  v_a uuid := pg_temp.mk_user('pp-a');
  v_b uuid := pg_temp.mk_user('pp-b');
  v_c uuid := pg_temp.mk_user('pp-c');
  v_d uuid := pg_temp.mk_user('pp-d');
  v_t uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_cd uuid;
  v_done uuid;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status, visibility)
  values ('pp-league', 'Player Portal League', 8, v_owner, 'league_active', 'public')
  returning id into v_t;

  insert into public.tournament_players (tournament_id, user_id, status)
  values (v_t, v_a, 'approved'), (v_t, v_b, 'approved'),
         (v_t, v_c, 'approved'), (v_t, v_d, 'approved');

  -- A finished round 1 against D, is mid round 2 against B, and has round 3
  -- against C scheduled but not reachable yet.
  insert into public.matches (tournament_id, stage, round_number, leg, player_a, player_b,
                              score_a, score_b, status)
  values (v_t, 'league', 1, 1, v_a, v_d, 3, 1, 'verified')
  returning id into v_done;

  insert into public.matches (tournament_id, stage, round_number, leg, player_a, player_b, status)
  values (v_t, 'league', 2, 1, v_a, v_b, 'ready')
  returning id into v_r1;

  insert into public.matches (tournament_id, stage, round_number, leg, player_a, player_b, status)
  values (v_t, 'league', 3, 1, v_a, v_c, 'pending')
  returning id into v_r2;

  -- A match A has nothing to do with.
  insert into public.matches (tournament_id, stage, round_number, leg, player_a, player_b, status)
  values (v_t, 'league', 2, 1, v_c, v_d, 'ready')
  returning id into v_cd;

  perform set_config('pp.t', v_t::text, false);
  perform set_config('pp.a', v_a::text, false);
  perform set_config('pp.b', v_b::text, false);
  perform set_config('pp.owner', v_owner::text, false);
  perform set_config('pp.done', v_done::text, false);
  perform set_config('pp.current', v_r1::text, false);
  perform set_config('pp.future', v_r2::text, false);
  perform set_config('pp.foreign', v_cd::text, false);
end $$;

-- =============================================================================
-- 1. A player reads their own history and their current match — and nothing
--    that comes after it.
-- =============================================================================
set role authenticated;
select pg_temp.act_as(current_setting('pp.a')::uuid);

do $$
declare v_n int;
begin
  select count(*) into v_n from public.matches
   where id = current_setting('pp.done')::uuid;
  assert v_n = 1, 'a player must be able to read a match they already played';

  select count(*) into v_n from public.matches
   where id = current_setting('pp.current')::uuid;
  assert v_n = 1, 'a player must be able to read the match they may play now';

  -- The whole point. Knowing the id buys nothing.
  select count(*) into v_n from public.matches
   where id = current_setting('pp.future')::uuid;
  assert v_n = 0,
    'ACCESS DENIED: a locked next-round match must not be readable, even by id';

  select count(*) into v_n from public.matches
   where id = current_setting('pp.foreign')::uuid;
  assert v_n = 0,
    'ACCESS DENIED: an unplayed match between two other players must not be readable';

  raise notice 'OK  round lock and cross-match access are enforced by policy';
end $$;

-- =============================================================================
-- 2. Completing the current match opens exactly one more, and no more.
-- =============================================================================
reset role;

update public.matches
   set status = 'verified', score_a = 2, score_b = 2
 where id = current_setting('pp.current')::uuid;

set role authenticated;
select pg_temp.act_as(current_setting('pp.a')::uuid);

do $$
declare v_n int;
begin
  select count(*) into v_n from public.matches
   where id = current_setting('pp.future')::uuid;
  assert v_n = 1, 'finishing the current match must open the next round';

  select count(*) into v_n from public.matches
   where id = current_setting('pp.foreign')::uuid;
  assert v_n = 0,
    'ACCESS DENIED: progressing a round must not reveal other players'' fixtures';

  raise notice 'OK  the next round opens on completion, and only for that player';
end $$;

-- =============================================================================
-- 3. The organiser still sees the whole schedule.
-- =============================================================================
select pg_temp.act_as(current_setting('pp.owner')::uuid);

do $$
declare v_n int;
begin
  select count(*) into v_n from public.matches
   where tournament_id = current_setting('pp.t')::uuid;
  assert v_n = 4, format('the organiser must see every fixture, saw %s', v_n);
  raise notice 'OK  the organiser sees the full schedule';
end $$;

-- =============================================================================
-- 4. Rule acceptance cannot be forged, rewritten, or erased.
-- =============================================================================
select pg_temp.act_as(current_setting('pp.a')::uuid);

do $$
declare
  v_blocked boolean := false;
  v_version int;
  v_id uuid;
begin
  select version into v_version from public.tournament_rules
   where tournament_id = current_setting('pp.t')::uuid;

  -- Accepting for yourself works.
  insert into public.tournament_rule_acceptances
    (tournament_id, user_id, rules_version, accepted, accepted_at)
  values (current_setting('pp.t')::uuid, current_setting('pp.a')::uuid,
          v_version, true, now())
  returning id into v_id;

  assert app.rules_accepted(current_setting('pp.t')::uuid,
                            current_setting('pp.a')::uuid),
    'an accepted decision must read back as accepted';

  -- Accepting on somebody else's behalf does not.
  begin
    insert into public.tournament_rule_acceptances
      (tournament_id, user_id, rules_version, accepted, accepted_at)
    values (current_setting('pp.t')::uuid, current_setting('pp.b')::uuid,
            v_version, true, now());
  exception when others then v_blocked := true; end;
  assert v_blocked, 'ACCESS DENIED: a player must not accept the rules for another player';

  -- And a decision already made cannot be quietly rewritten.
  v_blocked := false;
  begin
    update public.tournament_rule_acceptances set accepted = false where id = v_id;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a recorded decision must be immutable';

  v_blocked := false;
  begin
    delete from public.tournament_rule_acceptances where id = v_id;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'a recorded decision must not be deletable';

  raise notice 'OK  rule acceptance is per-player, append-only and unforgeable';
end $$;

-- =============================================================================
-- 5. A rules change forces the decision to be made again.
-- =============================================================================
reset role;
update public.tournament_rules
   set custom_text = 'المباريات تُلعب قبل العاشرة مساءً.'
 where tournament_id = current_setting('pp.t')::uuid;

set role authenticated;
select pg_temp.act_as(current_setting('pp.a')::uuid);

do $$
declare v_version int;
begin
  select version into v_version from public.tournament_rules
   where tournament_id = current_setting('pp.t')::uuid;
  assert v_version = 2, format('a live tournament must bump the rules version, got %s', v_version);

  assert not app.rules_accepted(current_setting('pp.t')::uuid,
                                current_setting('pp.a')::uuid),
    'acceptance of an earlier version must not carry over to a new one';

  raise notice 'OK  changing the rules withdraws acceptance until it is given again';
end $$;

-- =============================================================================
-- 6. Organiser-written status is readable by the player and writable by nobody
--    but the organiser. Private notes are readable by neither.
-- =============================================================================
reset role;
update public.tournament_players
   set public_status = 'جاهز للمباراة',
       public_note = 'يرجى الاتفاق مع الخصم على الموعد.',
       status_updated_by = current_setting('pp.owner')::uuid,
       status_updated_at = now()
 where tournament_id = current_setting('pp.t')::uuid
   and user_id = current_setting('pp.a')::uuid;

insert into public.player_admin_notes (tournament_id, user_id, note, updated_by)
values (current_setting('pp.t')::uuid, current_setting('pp.a')::uuid,
        'تأخر مرتين عن مواعيده.', current_setting('pp.owner')::uuid)
on conflict (tournament_id, user_id) do update set note = excluded.note;

set role authenticated;
select pg_temp.act_as(current_setting('pp.a')::uuid);

do $$
declare v_status text; v_n int; v_rows int;
begin
  select public_status into v_status from public.tournament_players
   where tournament_id = current_setting('pp.t')::uuid
     and user_id = current_setting('pp.a')::uuid;
  assert v_status = 'جاهز للمباراة', 'a player must be able to read the status set for them';

  -- RLS denials on UPDATE affect zero rows rather than raising.
  update public.tournament_players set public_status = 'بطل العالم'
   where tournament_id = current_setting('pp.t')::uuid
     and user_id = current_setting('pp.a')::uuid;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'ACCESS DENIED: a player must not be able to write their own status';

  select count(*) into v_n from public.player_admin_notes
   where tournament_id = current_setting('pp.t')::uuid
     and user_id = current_setting('pp.a')::uuid;
  assert v_n = 0, 'ACCESS DENIED: a player must never read an organiser''s private note';

  raise notice 'OK  player status is organiser-written, and private notes stay private';
end $$;

-- =============================================================================
-- 7. A push endpoint is a device address and belongs to one person.
-- =============================================================================
do $$
declare v_n int; v_blocked boolean := false;
begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
  values (current_setting('pp.a')::uuid, 'https://push.example/a', 'k', 's');

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
    values (current_setting('pp.b')::uuid, 'https://push.example/b', 'k', 's');
  exception when others then v_blocked := true; end;
  assert v_blocked, 'ACCESS DENIED: a device must not be registered against another account';

  select count(*) into v_n from public.push_subscriptions;
  assert v_n = 1, 'a player must only ever see their own subscriptions';

  raise notice 'OK  push subscriptions are per-account';
end $$;

-- =============================================================================
-- 8. Totals stay honest even though the fixtures are hidden.
-- =============================================================================
do $$
declare v_total int; v_verified int; v_visible int;
begin
  select total, verified into v_total, v_verified
    from app.tournament_match_totals(current_setting('pp.t')::uuid);

  select count(*) into v_visible from public.matches
   where tournament_id = current_setting('pp.t')::uuid;

  assert v_total = 4, format('the total must count every fixture, got %s', v_total);
  assert v_verified = 2, format('two matches are verified, got %s', v_verified);
  assert v_visible < v_total,
    'the point of the totals function is that the player cannot count the rows';

  raise notice 'OK  progress totals are served without exposing the schedule';
end $$;

reset role;

select 'player portal assertions hold' as result;

-- =============================================================================
-- 9. Join requests: yours to make and withdraw, the organiser's to answer.
-- =============================================================================
reset role;

do $$
declare
  v_owner uuid := pg_temp.mk_user('jr-owner');
  v_a uuid := pg_temp.mk_user('jr-a');
  v_b uuid := pg_temp.mk_user('jr-b');
  v_t uuid;
begin
  insert into public.tournaments (slug, name, capacity, created_by, status, visibility)
  values ('jr-cup', 'Join Request Cup', 8, v_owner, 'registration_open', 'invite_only')
  returning id into v_t;

  -- The tournament is born with a generated code; this replaces it with a
  -- fixed one so the lookup assertions below can name it.
  insert into public.tournament_join_codes (tournament_id, code) values (v_t, 'JOIN-TEST')
    on conflict (tournament_id) do update set code = excluded.code;

  insert into public.tournament_join_requests (tournament_id, user_id, status)
  values (v_t, v_b, 'pending');

  perform set_config('jr.t', v_t::text, false);
  perform set_config('jr.owner', v_owner::text, false);
  perform set_config('jr.a', v_a::text, false);
  perform set_config('jr.b', v_b::text, false);
end $$;

set role authenticated;
select pg_temp.act_as(current_setting('jr.a')::uuid);

do $$
declare
  v_n int;
  v_blocked boolean := false;
  v_id uuid;
  v_result jsonb;
begin
  -- Another player's request is not visible.
  select count(*) into v_n from public.tournament_join_requests;
  assert v_n = 0, 'ACCESS DENIED: a player must not see another player''s join request';

  -- The code is discoverable by code, and the lookup never returns the code.
  v_result := public.find_tournament_by_code('jointest');
  assert v_result->>'ok' = 'true', 'a valid code must resolve regardless of spacing or case';
  assert v_result->>'name' = 'Join Request Cup', 'the lookup must name the tournament';
  assert not (v_result ? 'join_code') and not (v_result ? 'code'),
    'the lookup must never hand back the code itself';

  assert public.find_tournament_by_code('ZZZZ-ZZZZ')->>'error' = 'CODE_NOT_FOUND',
    'an unknown code must be reported as unknown';

  -- An outsider cannot read the tournament row itself, which is why the seat
  -- count is checked from outside this block.
  assert not exists (select 1 from public.tournaments
                      where id = current_setting('jr.t')::uuid),
    'ACCESS DENIED: an invite-only tournament must stay hidden from a non-member';

  insert into public.tournament_join_requests (tournament_id, user_id)
  values (current_setting('jr.t')::uuid, current_setting('jr.a')::uuid)
  returning id into v_id;

  -- Having asked, the name becomes readable: a list of pending requests that
  -- cannot name what was asked for is not a list the player can act on.
  assert (select name from public.tournaments where id = current_setting('jr.t')::uuid)
         = 'Join Request Cup',
    'a requester must be able to read the name of the tournament they asked to join';

  -- Requesting on somebody else's behalf fails.
  begin
    insert into public.tournament_join_requests (tournament_id, user_id)
    values (current_setting('jr.t')::uuid, current_setting('jr.b')::uuid);
  exception when others then v_blocked := true; end;
  assert v_blocked, 'ACCESS DENIED: a player must not request on another player''s behalf';

  -- Approving your own request is not a thing a player can do. The row passes
  -- the policy's USING clause (it is theirs, and pending) and fails its WITH
  -- CHECK, so this raises rather than quietly touching nothing.
  v_blocked := false;
  begin
    update public.tournament_join_requests
       set status = 'approved', decided_at = now()
     where id = v_id;
    get diagnostics v_n = row_count;
    v_blocked := v_n = 0;
  exception when others then v_blocked := true; end;
  assert v_blocked, 'ACCESS DENIED: a player must not approve their own request';

  assert public.approve_join_request(v_id)->>'error' = 'FORBIDDEN',
    'ACCESS DENIED: the approval function must refuse a non-organiser';

  -- Withdrawing is allowed, and is the only state a player may write.
  update public.tournament_join_requests set status = 'cancelled' where id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'a player must be able to withdraw a pending request';

  perform set_config('jr.request_a', v_id::text, false);
  raise notice 'OK  a request is yours to make and withdraw, and nobody else''s to see';
end $$;

-- Two requests are outstanding and the roster is still empty: asking is not
-- joining, and eight hopefuls cannot fill an eight-player tournament.
reset role;
do $$
declare v_count int; v_requests int;
begin
  select player_count into v_count from public.tournaments
   where id = current_setting('jr.t')::uuid;
  select count(*) into v_requests from public.tournament_join_requests
   where tournament_id = current_setting('jr.t')::uuid;

  assert v_count = 0, format('a pending request must not occupy a slot, count is %s', v_count);
  assert v_requests = 2, format('two requests should exist, found %s', v_requests);
  raise notice 'OK  pending requests take no seats';
end $$;

set role authenticated;

-- The organiser answers it, and the seat is taken only then.
select pg_temp.act_as(current_setting('jr.owner')::uuid);

do $$
declare
  v_n int;
  v_before int;
  v_after int;
  v_request uuid;
  v_result jsonb;
begin
  select count(*) into v_n from public.tournament_join_requests
   where tournament_id = current_setting('jr.t')::uuid;
  assert v_n = 2, format('the organiser must see every request, saw %s', v_n);

  select id into v_request from public.tournament_join_requests
   where tournament_id = current_setting('jr.t')::uuid
     and user_id = current_setting('jr.b')::uuid;

  select player_count into v_before from public.tournaments
   where id = current_setting('jr.t')::uuid;

  v_result := public.approve_join_request(v_request);
  assert v_result->>'ok' = 'true', format('approval should succeed, got %s', v_result);

  select player_count into v_after from public.tournaments
   where id = current_setting('jr.t')::uuid;
  assert v_after = v_before + 1, 'approval is what takes the seat';

  assert exists (
    select 1 from public.tournament_players
     where tournament_id = current_setting('jr.t')::uuid
       and user_id = current_setting('jr.b')::uuid
       and status = 'approved'
  ), 'approval must produce an approved roster row';

  -- Answering twice changes nothing.
  assert public.approve_join_request(v_request)->>'error' = 'ALREADY_DECIDED',
    'a decided request must not be decidable again';

  raise notice 'OK  only the organiser decides, and the seat moves when they do';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 10. Asking again
-- ---------------------------------------------------------------------------
-- A withdrawal and a rejection both leave the row behind, because the unique
-- constraint keeps one request per player per tournament. So the question is
-- whether that row can be returned to a clean pending state by the player and
-- only by the player — and whether an approved one is beyond their reach.

set role authenticated;
select pg_temp.act_as(current_setting('jr.a')::uuid);

do $$
declare
  v_id uuid := current_setting('jr.request_a')::uuid;
  v_status public.join_request_status;
  v_cancelled timestamptz;
begin
  select status, cancelled_at into v_status, v_cancelled
    from public.tournament_join_requests where id = v_id;
  assert v_status = 'cancelled', format('the withdrawn request should be cancelled, is %s', v_status);
  assert v_cancelled is not null, 'a withdrawal must be stamped';

  -- Asking again after pulling the request back.
  update public.tournament_join_requests set status = 'pending' where id = v_id;

  select status, cancelled_at into v_status, v_cancelled
    from public.tournament_join_requests where id = v_id;
  assert v_status = 'pending', 'a withdrawn request must be re-openable by its owner';
  assert v_cancelled is null, 'reopening must clear the withdrawal stamp';

  raise notice 'OK  a withdrawn request can be made again';
end $$;

-- The organiser turns it down with a reason, and the player asks once more.
select pg_temp.act_as(current_setting('jr.owner')::uuid);

do $$
declare v_result jsonb;
begin
  v_result := public.reject_join_request(current_setting('jr.request_a')::uuid, '  الاسم داخل اللعبة ناقص  ');
  assert v_result->>'ok' = 'true', format('rejection should succeed, got %s', v_result);

  assert (select decision_note from public.tournament_join_requests
           where id = current_setting('jr.request_a')::uuid) = 'الاسم داخل اللعبة ناقص',
    'the note must be trimmed and kept';
end $$;

select pg_temp.act_as(current_setting('jr.a')::uuid);

do $$
declare
  v_id uuid := current_setting('jr.request_a')::uuid;
  v_status public.join_request_status;
  v_note text;
  v_decided timestamptz;
begin
  -- The player sees why they were turned down.
  select decision_note into v_note from public.tournament_join_requests where id = v_id;
  assert v_note = 'الاسم داخل اللعبة ناقص', 'a player must be able to read the reason';

  -- And may ask again. The old decision does not ride along.
  update public.tournament_join_requests set status = 'pending' where id = v_id;

  select status, decision_note, decided_at into v_status, v_note, v_decided
    from public.tournament_join_requests where id = v_id;
  assert v_status = 'pending', 'a rejected player must be able to ask again';
  assert v_note is null, 'asking again must clear the old reason';
  assert v_decided is null, 'asking again must clear the old decision';

  -- What they may never do is decide for themselves.
  begin
    update public.tournament_join_requests set status = 'approved' where id = v_id;
    raise exception 'a player approved their own request';
  exception
    when insufficient_privilege or check_violation then null;
  end;

  raise notice 'OK  a rejection is not a wall, and approval is not the player''s to write';
end $$;

-- Once accepted, the row is a record rather than a request.
select pg_temp.act_as(current_setting('jr.owner')::uuid);

do $$
declare v_result jsonb;
begin
  v_result := public.approve_join_request(current_setting('jr.request_a')::uuid);
  assert v_result->>'ok' = 'true', format('the second ask should be approvable, got %s', v_result);
end $$;

select pg_temp.act_as(current_setting('jr.a')::uuid);

do $$
declare v_n int;
begin
  update public.tournament_join_requests set status = 'pending'
   where id = current_setting('jr.request_a')::uuid;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'an approved request must not be reopened by the player';

  raise notice 'OK  an approved request is out of the player''s hands';
end $$;

reset role;
