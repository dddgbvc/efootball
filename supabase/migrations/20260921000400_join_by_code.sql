-- =============================================================================
-- 2026-09-21 — Joining by code, and an approval queue
--
-- The invitation link is gone. It failed in the way secret URLs always fail:
-- the organiser shared the wrong one — the public tournament page, which a
-- draft tournament refuses to everybody — and the person on the other end saw
-- a 404 with nothing to do about it.
--
-- What replaces it is a code the organiser reads out, and a request the
-- organiser answers. Both halves are deliberate acts by a named person, which
-- is what a link never was.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The code
--
-- In its own table rather than a column on `tournaments`, because every
-- participant can read their tournament's row. A code that admits people,
-- readable by everyone already admitted, is a code any of them can pass on —
-- which is the organiser's decision to make, not theirs.
--
-- Globally unique, because a player types it without knowing which tournament
-- it belongs to. No row means the door is shut.
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_join_codes (
  tournament_id uuid primary key references public.tournaments (id) on delete cascade,
  code          text not null unique,
  rotated_by    uuid references public.profiles (id) on delete set null,
  rotated_at    timestamptz not null default now(),
  constraint join_code_shape check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$')
);

/*
 * Codes are drawn from an alphabet with no I, O, 0 or 1, because this one gets
 * read down a phone line and typed by someone who has not seen it written.
 */
create or replace function app.generate_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_try  int := 0;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;

    exit when not exists (select 1 from public.tournament_join_codes c where c.code = v_code);

    v_try := v_try + 1;
    if v_try > 20 then
      raise exception 'JOIN_CODE_EXHAUSTED';
    end if;
  end loop;

  return v_code;
end;
$$;

-- Every tournament that can still take players gets one immediately, so the
-- organiser never meets an empty card and wonders what to do.
insert into public.tournament_join_codes (tournament_id, code)
select t.id, app.generate_join_code()
  from public.tournaments t
 where t.status not in ('completed', 'cancelled')
on conflict (tournament_id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. The request
--
-- A request is not a membership, and it deliberately does not live in
-- tournament_players: app.player_occupies_slot() counts 'registered' against
-- capacity, so eight hopefuls would fill an eight-player tournament before the
-- organiser had answered any of them. Nothing here touches player_count.
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.join_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.tournament_join_requests (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        public.join_request_status not null default 'pending',
  message       text,
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (tournament_id, user_id),
  constraint join_request_message_len check (message is null or char_length(message) <= 300),
  constraint join_request_note_len check (decision_note is null or char_length(decision_note) <= 300),
  -- Withdrawing is the player's act and approving is the organiser's, so they
  -- are stamped in different columns. Reading the row tells you which happened.
  constraint join_request_decided check (
    (status = 'pending' and decided_at is null and cancelled_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

/*
 * The timestamps are kept here rather than asked of the caller: a client that
 * forgets one would be refused by the constraint with an error about nothing
 * it can see.
 *
 * Reopening matters as much as withdrawing. A player who was turned down, or
 * who pulled their request back, may ask again — and their old row is the one
 * the unique constraint keeps, so it has to be returned to a clean pending
 * state here rather than left carrying a decision nobody made this time.
 */
create or replace function app.stamp_join_request_withdrawal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  if new.status = 'pending' and old.status <> 'pending' then
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    new.cancelled_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists join_requests_stamp_withdrawal on public.tournament_join_requests;
create trigger join_requests_stamp_withdrawal
  before update on public.tournament_join_requests
  for each row execute function app.stamp_join_request_withdrawal();

create index if not exists join_requests_tournament_idx
  on public.tournament_join_requests (tournament_id, status, created_at desc);
create index if not exists join_requests_user_idx
  on public.tournament_join_requests (user_id);

-- -----------------------------------------------------------------------------
-- 3. Finding a tournament from a code
--
-- Returns only what a player needs to recognise the tournament before asking
-- to join it, and returns the status explicitly: told "wrong code" when the
-- code is right but registration has not opened, a player concludes they
-- mistyped it and asks the organiser to read it out again.
-- -----------------------------------------------------------------------------
create or replace function public.find_tournament_by_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments%rowtype;
  v_user uuid := auth.uid();
  v_normalised text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  v_normalised := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(v_normalised) <> 8 then
    return jsonb_build_object('ok', false, 'error', 'CODE_MALFORMED');
  end if;
  v_normalised := substr(v_normalised, 1, 4) || '-' || substr(v_normalised, 5, 4);

  select t.* into v_t
    from public.tournaments t
    join public.tournament_join_codes c on c.tournament_id = t.id
   where c.code = v_normalised;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CODE_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'tournament_id', v_t.id,
    'name', v_t.name,
    'status', v_t.status,
    'capacity', v_t.capacity,
    'player_count', v_t.player_count,
    'accent_color', v_t.accent_color,
    'accepting', v_t.status in ('registration_open', 'registration_full'),
    'already_member', exists (
      select 1 from public.tournament_players p
       where p.tournament_id = v_t.id and p.user_id = v_user
    ),
    'existing_request', (
      select r.status from public.tournament_join_requests r
       where r.tournament_id = v_t.id and r.user_id = v_user
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Approving one
--
-- The single atomic entry into a roster. The row lock and the capacity check
-- are the same pair that made join_tournament() safe; over-registration is
-- impossible here for exactly the same reason.
-- -----------------------------------------------------------------------------
create or replace function public.approve_join_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_request    public.tournament_join_requests%rowtype;
  v_tournament public.tournaments%rowtype;
  v_player_id  uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_request
    from public.tournament_join_requests
   where id = p_request_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_FOUND');
  end if;

  if not app.is_tournament_admin(v_request.tournament_id, v_actor) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_request.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED',
                              'status', v_request.status);
  end if;

  -- Serialize every concurrent approval for this tournament.
  select * into v_tournament
    from public.tournaments
   where id = v_request.tournament_id
   for update;

  if v_tournament.status not in ('registration_open', 'registration_full') then
    return jsonb_build_object('ok', false, 'error', 'REGISTRATION_CLOSED',
                              'status', v_tournament.status);
  end if;

  if v_tournament.player_count >= v_tournament.capacity then
    return jsonb_build_object('ok', false, 'error', 'TOURNAMENT_FULL',
                              'player_count', v_tournament.player_count,
                              'capacity', v_tournament.capacity);
  end if;

  if exists (
    select 1 from public.tournament_players
     where tournament_id = v_request.tournament_id and user_id = v_request.user_id
  ) then
    update public.tournament_join_requests
       set status = 'approved', decided_by = v_actor, decided_at = now()
     where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_JOINED');
  end if;

  insert into public.tournament_players (tournament_id, user_id, status, approved_at, approved_by)
  values (v_request.tournament_id, v_request.user_id, 'approved', now(), v_actor)
  returning id into v_player_id;

  update public.tournament_join_requests
     set status = 'approved', decided_by = v_actor, decided_at = now()
   where id = p_request_id;

  -- Re-read: the count trigger has fired by now.
  select * into v_tournament from public.tournaments where id = v_request.tournament_id;

  if v_tournament.player_count >= v_tournament.capacity then
    update public.tournaments set status = 'registration_full'
     where id = v_tournament.id and status = 'registration_open';
  end if;

  return jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'user_id', v_request.user_id,
    'player_count', v_tournament.player_count,
    'capacity', v_tournament.capacity
  );
end;
$$;

create or replace function public.reject_join_request(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_request public.tournament_join_requests%rowtype;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_request
    from public.tournament_join_requests where id = p_request_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'REQUEST_NOT_FOUND');
  end if;

  if not app.is_tournament_admin(v_request.tournament_id, v_actor) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_request.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  update public.tournament_join_requests
     set status = 'rejected', decided_by = v_actor, decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'user_id', v_request.user_id);
end;
$$;

/* Rotating the code is how an organiser closes a door they have already opened. */
create or replace function public.rotate_join_code(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_code  text;
begin
  if v_actor is null or not app.is_tournament_admin(p_tournament_id, v_actor) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  v_code := app.generate_join_code();
  insert into public.tournament_join_codes (tournament_id, code, rotated_by, rotated_at)
  values (p_tournament_id, v_code, v_actor, now())
  on conflict (tournament_id)
  do update set code = excluded.code, rotated_by = excluded.rotated_by, rotated_at = excluded.rotated_at;

  return jsonb_build_object('ok', true, 'join_code', v_code);
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.tournament_join_codes    enable row level security;
alter table public.tournament_join_requests enable row level security;

-- Organisers only, on both sides. Players reach a tournament through
-- find_tournament_by_code(), which is a definer function and returns no code.
drop policy if exists join_codes_admin on public.tournament_join_codes;
create policy join_codes_admin on public.tournament_join_codes
  for all to authenticated
  using (app.is_tournament_admin(tournament_id))
  with check (app.is_tournament_admin(tournament_id));

-- A player sees their own requests. An organiser sees the requests for their
-- own tournament. Nobody sees anybody else's.
drop policy if exists join_requests_select on public.tournament_join_requests;
create policy join_requests_select on public.tournament_join_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_tournament_admin(tournament_id));

-- A request is made for yourself, and starts pending. The decision fields are
-- not the requester's to write.
drop policy if exists join_requests_insert on public.tournament_join_requests;
create policy join_requests_insert on public.tournament_join_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

-- A player may withdraw their own pending request, and may ask again after a
-- rejection or a withdrawal — circumstances change, and the organiser decides
-- again. What they may never do is reach a decision: 'approved' is not a state
-- this policy lets anyone write, and an approved row is not one it lets anyone
-- reopen, so the record of who was let in survives the player's own hand.
-- Approving and rejecting go through the definer functions.
drop policy if exists join_requests_cancel_own on public.tournament_join_requests;
drop policy if exists join_requests_update_own on public.tournament_join_requests;
create policy join_requests_update_own on public.tournament_join_requests
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and status in ('pending', 'rejected', 'cancelled')
  )
  with check (
    user_id = (select auth.uid())
    and status in ('pending', 'cancelled')
    and decided_by is null
    and decided_at is null
  );

grant select on public.tournament_join_codes to authenticated;
grant select, insert, update on public.tournament_join_requests to authenticated;

revoke all on function public.find_tournament_by_code(text) from public;
revoke all on function public.approve_join_request(uuid) from public;
revoke all on function public.reject_join_request(uuid, text) from public;
revoke all on function public.rotate_join_code(uuid) from public;

grant execute on function public.find_tournament_by_code(text) to authenticated;
grant execute on function public.approve_join_request(uuid) to authenticated;
grant execute on function public.reject_join_request(uuid, text) to authenticated;
grant execute on function public.rotate_join_code(uuid) to authenticated;

-- =============================================================================
-- Removing the invitation system
--
-- Dropped rather than left dormant: a dead table with a live foreign key is
-- something the next person has to reason about, and the feature it served is
-- gone. join_tournament() goes with it — it reads tournament_invites, and the
-- roster is now reached only through approve_join_request().
-- =============================================================================
drop function if exists public.join_tournament(uuid, text);

alter table public.tournament_players drop constraint if exists tournament_players_invite_fk;
alter table public.tournament_players drop column if exists invite_id;

drop table if exists public.invite_redemptions;
drop table if exists public.tournament_invites;

-- =============================================================================
-- Every tournament is born with a code
--
-- The code is how anyone joins, so a tournament without one is a tournament
-- nobody can enter — and the organiser has no reason to suspect it, because
-- the thing they are missing is a thing they never saw. Generating it with the
-- row removes the state entirely.
-- =============================================================================
create or replace function app.issue_join_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tournament_join_codes (tournament_id, code, rotated_by)
  values (new.id, app.generate_join_code(), new.created_by)
  on conflict (tournament_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tournaments_issue_join_code on public.tournaments;
create trigger tournaments_issue_join_code
  after insert on public.tournaments
  for each row execute function app.issue_join_code();

-- Anything created before this trigger existed.
insert into public.tournament_join_codes (tournament_id, code, rotated_by)
select t.id, app.generate_join_code(), t.created_by
  from public.tournaments t
 where not exists (
   select 1 from public.tournament_join_codes c where c.tournament_id = t.id
 );

-- =============================================================================
-- A tournament you have asked to join is one you can see the name of
--
-- Without this the player's own list of requests reads "بطولة" for every
-- invite-only tournament, because tournaments_select_public hides the row —
-- and the player is left unable to tell which of their requests is which, for
-- a name they were shown when they entered the code.
-- =============================================================================
drop policy if exists tournaments_select_requested on public.tournaments;
create policy tournaments_select_requested on public.tournaments
  for select to authenticated
  using (
    exists (
      select 1
        from public.tournament_join_requests r
       where r.tournament_id = tournaments.id
         and r.user_id = (select auth.uid())
    )
  );
