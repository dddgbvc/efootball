-- =============================================================================
-- 0600 — Trusted helper functions, capacity enforcement, atomic join,
--        official result application
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so that RLS policies can call them
-- without recursing into the policies of the tables they read.
-- -----------------------------------------------------------------------------
create or replace function app.is_platform_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = p_user), false);
$$;

create or replace function app.is_tournament_admin(p_tournament uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (
      select 1 from public.tournament_admins ta
      where ta.tournament_id = p_tournament and ta.user_id = p_user
    )
    or exists (
      select 1 from public.tournaments t
      where t.id = p_tournament and t.created_by = p_user
    )
    or app.is_platform_admin(p_user)
  );
$$;

create or replace function app.is_tournament_participant(p_tournament uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.tournament_players tp
    where tp.tournament_id = p_tournament
      and tp.user_id = p_user
      and tp.status in ('registered', 'approved', 'checked_in', 'no_show')
  );
$$;

create or replace function app.is_tournament_member(p_tournament uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_tournament_participant(p_tournament, p_user)
      or app.is_tournament_admin(p_tournament, p_user);
$$;

create or replace function app.tournament_is_public(p_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament
      and t.visibility = 'public'
      and t.status <> 'draft'
  );
$$;

create or replace function app.can_view_tournament(p_tournament uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.tournament_is_public(p_tournament) or app.is_tournament_member(p_tournament, p_user);
$$;

create or replace function app.is_chat_member(p_room uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.chat_room_members m
    where m.room_id = p_room and m.user_id = p_user
  );
$$;

create or replace function app.is_chat_muted(p_room uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_mutes cm
    where cm.room_id = p_room
      and cm.user_id = p_user
      and (cm.muted_until is null or cm.muted_until > now())
  );
$$;

create or replace function app.is_match_participant(p_match uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.matches m
    where m.id = p_match and (m.player_a = p_user or m.player_b = p_user)
  );
$$;

create or replace function app.match_tournament(p_match uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tournament_id from public.matches m where m.id = p_match;
$$;

create or replace function app.chat_room_tournament(p_room uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.tournament_id from public.chat_rooms r where r.id = p_room;
$$;

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Capacity enforcement.
--
-- Every change to occupancy issues an UPDATE against the tournaments row. Two
-- concurrent transactions therefore serialize on that row: the second one
-- blocks, re-reads the committed player_count under READ COMMITTED, and trips
-- the tournaments_player_count_within_capacity CHECK if the slot is gone.
-- Capacity can never be exceeded, regardless of what the application does.
-- -----------------------------------------------------------------------------
create or replace function app.player_occupies_slot(p_status public.player_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('registered', 'approved', 'checked_in', 'no_show');
$$;

create or replace function app.sync_tournament_player_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer := 0;
  v_tournament uuid;
begin
  if tg_op = 'INSERT' then
    v_tournament := new.tournament_id;
    v_delta := case when app.player_occupies_slot(new.status) then 1 else 0 end;
  elsif tg_op = 'DELETE' then
    v_tournament := old.tournament_id;
    v_delta := case when app.player_occupies_slot(old.status) then -1 else 0 end;
  else
    v_tournament := new.tournament_id;
    v_delta :=
      (case when app.player_occupies_slot(new.status) then 1 else 0 end)
      - (case when app.player_occupies_slot(old.status) then 1 else 0 end);
  end if;

  if v_delta <> 0 then
    update public.tournaments
       set player_count = player_count + v_delta
     where id = v_tournament;
  end if;

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- Auto-provision the tournament group chat and enrol participants.
-- -----------------------------------------------------------------------------
create or replace function app.ensure_tournament_room(p_tournament uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_name text;
begin
  select id into v_room
    from public.chat_rooms
   where tournament_id = p_tournament and type = 'tournament_group';

  if v_room is null then
    select name into v_name from public.tournaments where id = p_tournament;
    insert into public.chat_rooms (type, tournament_id, title)
    values ('tournament_group', p_tournament, v_name)
    on conflict do nothing
    returning id into v_room;

    if v_room is null then
      select id into v_room
        from public.chat_rooms
       where tournament_id = p_tournament and type = 'tournament_group';
    end if;
  end if;

  return v_room;
end;
$$;

create or replace function app.sync_tournament_room_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  v_room := app.ensure_tournament_room(new.tournament_id);
  if v_room is null then
    return new;
  end if;

  if app.player_occupies_slot(new.status) then
    insert into public.chat_room_members (room_id, user_id, role)
    values (v_room, new.user_id, 'member')
    on conflict (room_id, user_id) do nothing;
  else
    delete from public.chat_room_members where room_id = v_room and user_id = new.user_id;
  end if;

  return new;
end;
$$;

create or replace function app.sync_tournament_admin_room_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  v_room := app.ensure_tournament_room(new.tournament_id);
  if v_room is not null then
    insert into public.chat_room_members (room_id, user_id, role)
    values (v_room, new.user_id, 'admin')
    on conflict (room_id, user_id) do update set role = 'admin';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profile bootstrap for every new auth user.
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display text;
begin
  v_display := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'player'), '@', 1)
  );

  if char_length(v_display) < 2 then
    v_display := 'لاعب ' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, display_name, full_name)
  values (new.id, left(v_display, 40), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- ATOMIC TOURNAMENT JOIN
--
-- One trusted operation: validate tournament, state, invitation, expiry, usage,
-- duplicate membership and capacity, then insert — all under a row lock on the
-- tournament. Frontend counts are never authoritative.
-- -----------------------------------------------------------------------------
create or replace function public.join_tournament(
  p_tournament_id uuid,
  p_invite_token  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_tournament public.tournaments%rowtype;
  v_invite     public.tournament_invites%rowtype;
  v_status     public.player_status;
  v_player_id  uuid;
  v_waitlisted boolean := false;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  if not exists (select 1 from public.profiles where id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'PROFILE_REQUIRED');
  end if;

  -- Serialize every concurrent join attempt for this tournament.
  select * into v_tournament
    from public.tournaments
   where id = p_tournament_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TOURNAMENT_NOT_FOUND');
  end if;

  -- `registration_full` is deliberately allowed through to the capacity check
  -- below. It is a derived state, so a latecomer must be told the tournament is
  -- full rather than that registration closed — and if a withdrawal has freed a
  -- slot in the meantime, the join legitimately succeeds.
  if v_tournament.status not in ('registration_open', 'registration_full') then
    return jsonb_build_object('ok', false, 'error', 'REGISTRATION_CLOSED',
                              'status', v_tournament.status);
  end if;

  if v_tournament.registration_opens_at is not null
     and now() < v_tournament.registration_opens_at then
    return jsonb_build_object('ok', false, 'error', 'REGISTRATION_NOT_OPEN_YET');
  end if;

  if v_tournament.registration_closes_at is not null
     and now() > v_tournament.registration_closes_at then
    return jsonb_build_object('ok', false, 'error', 'REGISTRATION_CLOSED');
  end if;

  if exists (
    select 1 from public.tournament_players
     where tournament_id = p_tournament_id and user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_JOINED');
  end if;

  -- Invitation validation
  if v_tournament.visibility = 'invite_only' or p_invite_token is not null then
    if p_invite_token is null then
      return jsonb_build_object('ok', false, 'error', 'INVITE_REQUIRED');
    end if;

    select * into v_invite
      from public.tournament_invites
     where token = p_invite_token
     for update;

    if not found or v_invite.tournament_id <> p_tournament_id then
      return jsonb_build_object('ok', false, 'error', 'INVITE_INVALID');
    end if;
    if v_invite.revoked_at is not null then
      return jsonb_build_object('ok', false, 'error', 'INVITE_REVOKED');
    end if;
    if v_invite.expires_at is not null and now() > v_invite.expires_at then
      return jsonb_build_object('ok', false, 'error', 'INVITE_EXPIRED');
    end if;
    if v_invite.max_uses is not null and v_invite.used_count >= v_invite.max_uses then
      return jsonb_build_object('ok', false, 'error', 'INVITE_EXHAUSTED');
    end if;
  end if;

  -- Capacity. The CHECK constraint is the final authority; this branch exists so
  -- that a full tournament returns a clean domain error instead of a 23514.
  if v_tournament.player_count >= v_tournament.capacity then
    if v_tournament.waitlist_enabled then
      insert into public.tournament_waitlist (tournament_id, user_id, position)
      values (
        p_tournament_id,
        v_user,
        coalesce((select max(position) from public.tournament_waitlist
                   where tournament_id = p_tournament_id), 0) + 1
      )
      on conflict (tournament_id, user_id) do nothing;
      v_waitlisted := true;
      return jsonb_build_object('ok', false, 'error', 'TOURNAMENT_FULL', 'waitlisted', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'TOURNAMENT_FULL', 'waitlisted', false);
  end if;

  v_status := case
    when coalesce(v_invite.auto_approve, v_tournament.auto_approve) then 'approved'
    else 'registered'
  end;

  insert into public.tournament_players
    (tournament_id, user_id, status, invite_id, approved_at)
  values
    (p_tournament_id, v_user, v_status, v_invite.id,
     case when v_status = 'approved' then now() else null end)
  returning id into v_player_id;

  if v_invite.id is not null then
    update public.tournament_invites
       set used_count = used_count + 1
     where id = v_invite.id;

    insert into public.invite_redemptions (invite_id, user_id)
    values (v_invite.id, v_user)
    on conflict do nothing;
  end if;

  -- Re-read the authoritative count after the trigger has run.
  select player_count into v_tournament.player_count
    from public.tournaments where id = p_tournament_id;

  if v_tournament.player_count >= v_tournament.capacity then
    update public.tournaments set status = 'registration_full'
     where id = p_tournament_id and status = 'registration_open';
  elsif v_tournament.player_count < v_tournament.capacity then
    update public.tournaments set status = 'registration_open'
     where id = p_tournament_id and status = 'registration_full';
  end if;

  insert into public.audit_logs (tournament_id, actor_id, action, entity_type, entity_id, after_state)
  values (p_tournament_id, v_user, 'PLAYER_JOINED', 'tournament_player', v_player_id::text,
          jsonb_build_object('status', v_status, 'invite_id', v_invite.id));

  insert into public.tournament_activity (tournament_id, kind, message, actor_id)
  values (p_tournament_id, 'player_joined',
          (select display_name from public.profiles where id = v_user) || ' انضم إلى البطولة',
          v_user);

  return jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'status', v_status,
    'player_count', v_tournament.player_count,
    'capacity', v_tournament.capacity,
    'waitlisted', v_waitlisted
  );
exception
  when check_violation then
    -- Lost the race for the final slot.
    return jsonb_build_object('ok', false, 'error', 'TOURNAMENT_FULL', 'waitlisted', false);
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_JOINED');
end;
$$;

revoke all on function public.join_tournament(uuid, text) from public;
grant execute on function public.join_tournament(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- CHECK-IN
-- -----------------------------------------------------------------------------
create or replace function public.check_in_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_t    public.tournaments%rowtype;
  v_row  public.tournament_players%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TOURNAMENT_NOT_FOUND');
  end if;
  if v_t.status <> 'check_in' then
    return jsonb_build_object('ok', false, 'error', 'CHECK_IN_NOT_OPEN');
  end if;
  if v_t.check_in_closes_at is not null and now() > v_t.check_in_closes_at then
    return jsonb_build_object('ok', false, 'error', 'CHECK_IN_WINDOW_CLOSED');
  end if;

  select * into v_row from public.tournament_players
   where tournament_id = p_tournament_id and user_id = v_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  end if;
  if v_row.status not in ('registered', 'approved', 'no_show') then
    return jsonb_build_object('ok', false, 'error', 'NOT_ELIGIBLE', 'status', v_row.status);
  end if;

  update public.tournament_players
     set status = 'checked_in', checked_in_at = now()
   where id = v_row.id;

  insert into public.audit_logs (tournament_id, actor_id, action, entity_type, entity_id)
  values (p_tournament_id, v_user, 'PLAYER_CHECKED_IN', 'tournament_player', v_row.id::text);

  return jsonb_build_object('ok', true, 'checked_in_at', now());
end;
$$;

revoke all on function public.check_in_tournament(uuid) from public;
grant execute on function public.check_in_tournament(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- DIRECT CONVERSATIONS — deterministic key prevents duplicate 1:1 rooms.
-- -----------------------------------------------------------------------------
create or replace function app.dm_key(a uuid, b uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select least(a::text, b::text) || ':' || greatest(a::text, b::text);
$$;

create or replace function public.open_direct_room(p_other_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_key  text;
  v_room uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_other_user is null or p_other_user = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TARGET');
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user) then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if exists (
    select 1 from public.player_blocks
     where (blocker_id = p_other_user and blocked_id = v_user)
        or (blocker_id = v_user and blocked_id = p_other_user)
  ) then
    return jsonb_build_object('ok', false, 'error', 'BLOCKED');
  end if;

  v_key := app.dm_key(v_user, p_other_user);

  select id into v_room from public.chat_rooms where dm_key = v_key and type = 'direct';

  if v_room is null then
    insert into public.chat_rooms (type, dm_key) values ('direct', v_key)
    on conflict (dm_key) where type = 'direct' do nothing
    returning id into v_room;

    if v_room is null then
      select id into v_room from public.chat_rooms where dm_key = v_key and type = 'direct';
    end if;

    insert into public.chat_room_members (room_id, user_id)
    values (v_room, v_user), (v_room, p_other_user)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'room_id', v_room);
end;
$$;

revoke all on function public.open_direct_room(uuid) from public;
grant execute on function public.open_direct_room(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Read state
-- -----------------------------------------------------------------------------
create or replace function public.mark_room_read(p_room_id uuid, p_message_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if not app.is_chat_member(p_room_id, v_user) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  insert into public.chat_read_state (room_id, user_id, last_read_at, last_read_message_id)
  values (p_room_id, v_user, now(), p_message_id)
  on conflict (room_id, user_id)
  do update set last_read_at = now(),
                last_read_message_id = coalesce(excluded.last_read_message_id,
                                                public.chat_read_state.last_read_message_id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_room_read(uuid, uuid) from public;
grant execute on function public.mark_room_read(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- OFFICIAL RESULT APPLICATION
--
-- The single place where an official score becomes competition state. Updates
-- the match, the tie aggregate, extra time / penalties, advancement and the
-- tournament stage in one transaction. Only the service role may execute it:
-- players and tournament admins reach it exclusively through server routes that
-- have already checked authorization.
-- -----------------------------------------------------------------------------
create or replace function public.apply_official_result(
  p_match_id    uuid,
  p_score_a     smallint,
  p_score_b     smallint,
  p_source      text,
  p_actor       uuid default null,
  p_note        text default null,
  p_extra_time_a smallint default null,
  p_extra_time_b smallint default null,
  p_penalties_a  smallint default null,
  p_penalties_b  smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match   public.matches%rowtype;
  v_before  jsonb;
  v_tie     public.knockout_ties%rowtype;
  v_rules   public.tournament_rules%rowtype;
  v_leg1    public.matches%rowtype;
  v_agg_a   integer;
  v_agg_b   integer;
  v_winner  uuid;
  v_tie_done boolean := false;
  v_needs_et boolean := false;
  v_needs_pens boolean := false;
begin
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SCORE');
  end if;
  if p_source not in ('ai_verified', 'admin_override', 'walkover') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SOURCE');
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if v_match.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'MATCH_CANCELLED');
  end if;

  v_before := jsonb_build_object(
    'score_a', v_match.score_a, 'score_b', v_match.score_b,
    'status', v_match.status, 'winner_id', v_match.winner_id,
    'official_source', v_match.official_source
  );

  select * into v_rules from public.tournament_rules where tournament_id = v_match.tournament_id;

  -- Resolve the single-match winner (league draws stay null).
  v_winner := case
    when p_score_a > p_score_b then v_match.player_a
    when p_score_b > p_score_a then v_match.player_b
    else null
  end;

  update public.matches
     set score_a = p_score_a,
         score_b = p_score_b,
         extra_time_a = p_extra_time_a,
         extra_time_b = p_extra_time_b,
         penalties_a = p_penalties_a,
         penalties_b = p_penalties_b,
         went_to_extra_time = (p_extra_time_a is not null),
         went_to_penalties = (p_penalties_a is not null),
         winner_id = v_winner,
         status = 'verified',
         official_source = p_source,
         verified_at = now(),
         verified_by = p_actor,
         verification_note = p_note,
         completed_at = now(),
         updated_at = now()
   where id = p_match_id;

  -- Close any open dispute for this match.
  update public.verification_cases
     set status = 'resolved',
         resolved_at = now(),
         resolved_by = p_actor,
         resolution = p_source
   where match_id = p_match_id and status = 'open';

  -- ---------------------------------------------------------------------------
  -- Knockout bookkeeping
  -- ---------------------------------------------------------------------------
  if v_match.tie_id is not null then
    select * into v_tie from public.knockout_ties where id = v_match.tie_id for update;

    -- Aggregate is always recomputed from verified legs; never incremented.
    select
      coalesce(sum(case when m.player_a = v_tie.player_a then m.score_a else m.score_b end), 0),
      coalesce(sum(case when m.player_a = v_tie.player_a then m.score_b else m.score_a end), 0)
      into v_agg_a, v_agg_b
      from public.matches m
     where m.tie_id = v_tie.id and m.status in ('verified', 'completed') and m.score_a is not null;

    v_winner := null;

    if not v_tie.two_legs or v_match.leg = 2 then
      -- Decide the tie.
      if v_agg_a > v_agg_b then
        v_winner := v_tie.player_a;
      elsif v_agg_b > v_agg_a then
        v_winner := v_tie.player_b;
      else
        -- Away goals, when explicitly enabled.
        if coalesce(v_rules.away_goals_rule, false) and v_tie.two_legs then
          select * into v_leg1 from public.matches where tie_id = v_tie.id and leg = 1;
          if v_leg1.id is not null and v_leg1.score_a is not null then
            -- Leg 1 is hosted by player_a: player_b's away goals are leg1 score_b,
            -- player_a's away goals are leg 2 (the current match) score for player_a.
            declare
              v_away_a integer := case when v_match.player_a = v_tie.player_a
                                       then v_match.score_a else v_match.score_b end;
              v_away_b integer := case when v_leg1.player_a = v_tie.player_a
                                       then v_leg1.score_b else v_leg1.score_a end;
            begin
              if v_away_a > v_away_b then
                v_winner := v_tie.player_a;
              elsif v_away_b > v_away_a then
                v_winner := v_tie.player_b;
              end if;
            end;
          end if;
        end if;

        if v_winner is null then
          -- Extra time, then penalties, in that order, only after the last leg.
          if p_penalties_a is not null and p_penalties_b is not null
             and p_penalties_a <> p_penalties_b then
            v_winner := case when p_penalties_a > p_penalties_b
                             then v_match.player_a else v_match.player_b end;
          elsif coalesce(v_rules.knockout_extra_time, true) and p_extra_time_a is null then
            v_needs_et := true;
          elsif coalesce(v_rules.knockout_penalties, true) then
            v_needs_pens := true;
          end if;
        end if;
      end if;
    end if;

    v_tie_done := v_winner is not null;

    update public.knockout_ties
       set aggregate_a = v_agg_a,
           aggregate_b = v_agg_b,
           extra_time_a = coalesce(p_extra_time_a, extra_time_a),
           extra_time_b = coalesce(p_extra_time_b, extra_time_b),
           penalties_a = coalesce(p_penalties_a, penalties_a),
           penalties_b = coalesce(p_penalties_b, penalties_b),
           winner_id = v_winner,
           completed_at = case when v_tie_done then now() else null end,
           status = case
             when v_tie_done then 'completed'::public.tie_status
             when v_needs_pens then 'penalties'::public.tie_status
             when v_needs_et then 'extra_time'::public.tie_status
             when v_match.leg = 1 and v_tie.two_legs then 'second_leg'::public.tie_status
             else 'first_leg'::public.tie_status
           end
     where id = v_tie.id;

    -- Advance the winner into the next tie slot.
    if v_tie_done and v_tie.next_tie_id is not null and v_tie.next_tie_slot is not null then
      if v_tie.next_tie_slot = 'a' then
        update public.knockout_ties set player_a = v_winner where id = v_tie.next_tie_id;
      else
        update public.knockout_ties set player_b = v_winner where id = v_tie.next_tie_id;
      end if;
    end if;

    -- Crown the champion.
    if v_tie_done and v_tie.stage = 'final' then
      update public.tournaments
         set champion_id = v_winner, status = 'completed', completed_at = now()
       where id = v_match.tournament_id;

      insert into public.audit_logs (tournament_id, actor_id, action, entity_type, entity_id, after_state)
      values (v_match.tournament_id, p_actor, 'TOURNAMENT_COMPLETED', 'tournament',
              v_match.tournament_id::text, jsonb_build_object('champion_id', v_winner));
    end if;
  end if;

  insert into public.audit_logs
    (tournament_id, actor_id, action, entity_type, entity_id, reason, before_state, after_state)
  values (
    v_match.tournament_id, p_actor,
    case when p_source = 'admin_override' then 'ADMIN_RESULT_OVERRIDE' else 'MATCH_VERIFIED' end,
    'match', p_match_id::text, p_note, v_before,
    jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b,
                       'source', p_source, 'tie_winner', v_winner)
  );

  return jsonb_build_object(
    'ok', true,
    'match_id', p_match_id,
    'tie_id', v_match.tie_id,
    'tie_winner', v_winner,
    'tie_completed', v_tie_done,
    'needs_extra_time', v_needs_et,
    'needs_penalties', v_needs_pens,
    'aggregate_a', v_agg_a,
    'aggregate_b', v_agg_b
  );
end;
$$;

revoke all on function public.apply_official_result(uuid, smallint, smallint, text, uuid, text, smallint, smallint, smallint, smallint) from public;
revoke all on function public.apply_official_result(uuid, smallint, smallint, text, uuid, text, smallint, smallint, smallint, smallint) from authenticated, anon;
grant execute on function public.apply_official_result(uuid, smallint, smallint, text, uuid, text, smallint, smallint, smallint, smallint) to service_role;

-- -----------------------------------------------------------------------------
-- Trusted system chat message. Service role only — players cannot forge these.
-- -----------------------------------------------------------------------------
create or replace function public.post_system_message(
  p_tournament_id uuid,
  p_body text,
  p_event text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_id   uuid;
begin
  v_room := app.ensure_tournament_room(p_tournament_id);
  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND');
  end if;

  insert into public.chat_messages (room_id, sender_id, kind, body, system_event)
  values (v_room, null, 'system', p_body, p_event)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'message_id', v_id, 'room_id', v_room);
end;
$$;

revoke all on function public.post_system_message(uuid, text, text) from public;
revoke all on function public.post_system_message(uuid, text, text) from authenticated, anon;
grant execute on function public.post_system_message(uuid, text, text) to service_role;
