-- =============================================================================
-- 2026-09-21 — Player Portal
--
-- A player's experience of a tournament is not a smaller copy of the
-- organiser's. It is a different set of facts: their own matches, the one they
-- may play next, where they stand, and what the organiser has told them. This
-- migration puts the authority for all of that in the database, because a
-- portal that hides a future opponent in the UI has not hidden it at all.
--
-- Four things are added:
--   1. versioned rules, and an append-only record of who accepted which version
--   2. an organiser-written player status, plus private notes kept in their own
--      table so no policy mistake can leak them
--   3. a deterministic match-unlock rule, enforced in the SELECT policy on
--      matches rather than in a query the client could rewrite
--   4. push subscriptions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Versioned rules
-- -----------------------------------------------------------------------------
alter table public.tournament_rules
  add column if not exists version integer not null default 1,
  add column if not exists custom_text text;

comment on column public.tournament_rules.custom_text is
  'The organiser''s own rules, in their words. Shown above the structural rules.';

alter table public.tournament_rules
  drop constraint if exists rules_version_positive;
alter table public.tournament_rules
  add constraint rules_version_positive check (version >= 1);

/*
 * The version moves only once the tournament is live. While it is still a
 * draft the organiser is composing the rules, and bumping the version on every
 * keystroke would ask players to re-accept a document nobody has read yet.
 */
create or replace function app.bump_rules_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.version is distinct from old.version then
    -- An explicit version change is the caller's business, not ours.
    return new;
  end if;

  if (
       new.custom_text is distinct from old.custom_text
    or new.match_duration_minutes is distinct from old.match_duration_minutes
    or new.league_double_round is distinct from old.league_double_round
    or new.points_win is distinct from old.points_win
    or new.points_draw is distinct from old.points_draw
    or new.points_loss is distinct from old.points_loss
    or new.tiebreakers is distinct from old.tiebreakers
    or new.direct_semifinal_slots is distinct from old.direct_semifinal_slots
    or new.playoff_slots is distinct from old.playoff_slots
    or new.knockout_two_legs is distinct from old.knockout_two_legs
    or new.knockout_extra_time is distinct from old.knockout_extra_time
    or new.knockout_penalties is distinct from old.knockout_penalties
    or new.away_goals_rule is distinct from old.away_goals_rule
    or new.semifinal_draw_mode is distinct from old.semifinal_draw_mode
    or new.third_place_match is distinct from old.third_place_match
    or new.big_win_goal_diff is distinct from old.big_win_goal_diff
  ) and exists (
    select 1 from public.tournaments t
     where t.id = new.tournament_id and t.status <> 'draft'
  ) then
    new.version := old.version + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_rules_version on public.tournament_rules;
create trigger tournament_rules_version
  before update on public.tournament_rules
  for each row execute function app.bump_rules_version();

-- -----------------------------------------------------------------------------
-- 2. Rule acceptance — append-only
--
-- A row is a decision at a moment, never the current state. The current state
-- is the most recent row for the version in force, which is what lets a player
-- who declined change their mind without any record being rewritten.
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_rule_acceptances (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  rules_version integer not null,
  accepted      boolean not null,
  accepted_at   timestamptz,
  declined_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint rule_acceptance_version check (rules_version >= 1),
  constraint rule_acceptance_decision check (
    (accepted and accepted_at is not null and declined_at is null)
    or (not accepted and declined_at is not null and accepted_at is null)
  )
);

create index if not exists rule_acceptances_lookup_idx
  on public.tournament_rule_acceptances (tournament_id, user_id, rules_version, created_at desc);

create or replace function app.guard_rule_acceptance_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'RULE_ACCEPTANCE_IMMUTABLE: a decision is a record of a moment, not a state';
end;
$$;

drop trigger if exists rule_acceptances_immutable on public.tournament_rule_acceptances;
create trigger rule_acceptances_immutable
  before update or delete on public.tournament_rule_acceptances
  for each row execute function app.guard_rule_acceptance_immutability();

/* The decision in force for a player, against the version in force. */
create or replace function app.rules_decision(p_tournament uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select a.accepted
    from public.tournament_rule_acceptances a
    join public.tournament_rules r on r.tournament_id = a.tournament_id
   where a.tournament_id = p_tournament
     and a.user_id = p_user
     and a.rules_version = r.version
   order by a.created_at desc
   limit 1;
$$;

create or replace function app.rules_accepted(p_tournament uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(app.rules_decision(p_tournament, p_user), false);
$$;

-- -----------------------------------------------------------------------------
-- 3. Organiser-written player status
--
-- The player reads it and can never write it: tournament_players has no UPDATE
-- policy for `authenticated` other than the admin one, so the column is
-- organiser-only by construction rather than by convention.
-- -----------------------------------------------------------------------------
alter table public.tournament_players
  add column if not exists public_status     text,
  add column if not exists public_note       text,
  add column if not exists status_updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists status_updated_at timestamptz;

alter table public.tournament_players
  drop constraint if exists player_public_status_len;
alter table public.tournament_players
  add constraint player_public_status_len
  check (public_status is null or char_length(public_status) between 1 and 60);

alter table public.tournament_players
  drop constraint if exists player_public_note_len;
alter table public.tournament_players
  add constraint player_public_note_len
  check (public_note is null or char_length(public_note) <= 400);

/*
 * Private notes live in their own table rather than a column on the row the
 * player is allowed to read. Column-level exposure is one policy mistake away
 * from a leak; a separate table with an admin-only policy is not.
 */
create table if not exists public.player_admin_notes (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  note          text not null,
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (tournament_id, user_id),
  constraint player_admin_note_len check (char_length(note) <= 2000)
);

-- -----------------------------------------------------------------------------
-- 4. Invitation lifecycle
-- -----------------------------------------------------------------------------
alter table public.tournament_invites
  add column if not exists opened_at  timestamptz,
  add column if not exists claimed_by uuid references public.profiles (id) on delete set null,
  add column if not exists claimed_at timestamptz;

-- -----------------------------------------------------------------------------
-- 5. Match unlocking
--
-- Stages and rounds collapse into one integer so "earlier than" is a single
-- comparison. league < playoff < semifinal < third_place < final, and within a
-- stage the round number orders the legs.
-- -----------------------------------------------------------------------------
create or replace function app.match_order_key(p_stage public.match_stage, p_round smallint)
returns integer
language sql immutable set search_path = ''
as $$
  select (case p_stage
            when 'league'      then 1
            when 'playoff'     then 2
            when 'semifinal'   then 3
            when 'third_place' then 4
            when 'final'       then 5
          end) * 1000 + coalesce(p_round, 0)::int;
$$;

/*
 * A player may open a match of theirs when nothing of theirs is still
 * outstanding in an earlier round. Their finished matches stay open forever —
 * that is their own history. Everything else is shut, including the identity
 * of the opponent waiting in it.
 */
create or replace function app.player_match_unlocked(p_match uuid, p_user uuid default auth.uid())
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  m          record;
  v_frontier integer;
begin
  if p_user is null then
    return false;
  end if;

  select id, tournament_id, stage, round_number, status, player_a, player_b
    into m
    from public.matches
   where id = p_match;

  if not found then
    return false;
  end if;

  if m.player_a is distinct from p_user and m.player_b is distinct from p_user then
    return false;
  end if;

  if m.status in ('verified', 'completed', 'cancelled') then
    return true;
  end if;

  select min(app.match_order_key(x.stage, x.round_number))
    into v_frontier
    from public.matches x
   where x.tournament_id = m.tournament_id
     and (x.player_a = p_user or x.player_b = p_user)
     and x.status not in ('verified', 'completed', 'cancelled');

  return app.match_order_key(m.stage, m.round_number) <= coalesce(v_frontier, 0);
end;
$$;

create or replace function app.can_player_view_match(p_match uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_tournament_admin(app.match_tournament(p_match), p_user)
      or app.player_match_unlocked(p_match, p_user);
$$;

/*
 * The fixture list stops being public before it is played.
 *
 * Previously any viewer of a tournament could read every match row, which made
 * the round lock cosmetic: a player could read their next three opponents
 * straight from the API. Now a participant sees their own matches up to the
 * round they have reached, everyone else sees results, and only the organiser
 * sees the schedule ahead.
 */
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated, anon
  using (
    app.is_tournament_admin(tournament_id)
    or app.player_match_unlocked(id)
    or (
      app.can_view_tournament(tournament_id)
      and status in ('verified', 'completed')
    )
  );

/*
 * Totals for progress indicators. A participant can no longer count the
 * fixtures themselves, and "16 of 16" would be a lie where "16 of 56" is the
 * truth, so the count is served by a definer function that returns two numbers
 * and nothing else.
 */
create or replace function app.tournament_match_totals(p_tournament uuid)
returns table (total integer, verified integer)
language sql stable security definer set search_path = ''
as $$
  select
    count(*)::int,
    count(*) filter (where m.status in ('verified', 'completed'))::int
  from public.matches m
  where m.tournament_id = p_tournament
    and app.can_view_tournament(p_tournament);
$$;

-- -----------------------------------------------------------------------------
-- 6. Push subscriptions
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth_secret  text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_at    timestamptz
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.tournament_rule_acceptances enable row level security;
alter table public.player_admin_notes         enable row level security;
alter table public.push_subscriptions         enable row level security;

-- A decision is readable by the player who made it and by the organisers of
-- that tournament. Nobody else, ever.
drop policy if exists rule_acceptances_select on public.tournament_rule_acceptances;
create policy rule_acceptances_select on public.tournament_rule_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_tournament_admin(tournament_id));

-- A player records their own decision, for themselves, against the version
-- actually in force. Forging one for somebody else fails three ways.
drop policy if exists rule_acceptances_insert on public.tournament_rule_acceptances;
create policy rule_acceptances_insert on public.tournament_rule_acceptances
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.tournament_players p
       where p.tournament_id = tournament_rule_acceptances.tournament_id
         and p.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tournament_rules r
       where r.tournament_id = tournament_rule_acceptances.tournament_id
         and r.version = tournament_rule_acceptances.rules_version
    )
  );

-- Private notes: organisers only, on both sides.
drop policy if exists player_admin_notes_admin on public.player_admin_notes;
create policy player_admin_notes_admin on public.player_admin_notes
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

-- A push endpoint is a device address. It belongs to one person.
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- =============================================================================
-- Grants
-- =============================================================================
grant select, insert on public.tournament_rule_acceptances to authenticated;
grant select, insert, update, delete on public.player_admin_notes to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

grant execute on function app.rules_decision(uuid, uuid) to authenticated;
grant execute on function app.rules_accepted(uuid, uuid) to authenticated;
grant execute on function app.can_player_view_match(uuid, uuid) to authenticated;
grant execute on function app.tournament_match_totals(uuid) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- PostgREST surface
--
-- `app` is deliberately not an exposed schema, so anything the client calls
-- needs a thin wrapper in `public`. This one returns two integers for a
-- tournament the caller is already allowed to view, and nothing else.
-- -----------------------------------------------------------------------------
create or replace function public.tournament_match_totals(p_tournament uuid)
returns table (total integer, verified integer)
language sql stable security definer set search_path = ''
as $$
  select t.total, t.verified from app.tournament_match_totals(p_tournament) t;
$$;

revoke execute on function public.tournament_match_totals(uuid) from public;
grant execute on function public.tournament_match_totals(uuid) to authenticated, anon;
