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
