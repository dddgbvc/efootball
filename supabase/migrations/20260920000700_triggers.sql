-- =============================================================================
-- 0700 — Triggers
-- =============================================================================

-- updated_at ------------------------------------------------------------------
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

drop trigger if exists tournaments_touch on public.tournaments;
create trigger tournaments_touch before update on public.tournaments
  for each row execute function app.touch_updated_at();

drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches
  for each row execute function app.touch_updated_at();

drop trigger if exists news_posts_touch on public.news_posts;
create trigger news_posts_touch before update on public.news_posts
  for each row execute function app.touch_updated_at();

-- capacity --------------------------------------------------------------------
drop trigger if exists tournament_players_count on public.tournament_players;
create trigger tournament_players_count
  after insert or update of status or delete on public.tournament_players
  for each row execute function app.sync_tournament_player_count();

-- tournament group chat membership --------------------------------------------
drop trigger if exists tournament_players_room on public.tournament_players;
create trigger tournament_players_room
  after insert or update of status on public.tournament_players
  for each row execute function app.sync_tournament_room_membership();

drop trigger if exists tournament_admins_room on public.tournament_admins;
create trigger tournament_admins_room
  after insert on public.tournament_admins
  for each row execute function app.sync_tournament_admin_room_membership();

-- profile bootstrap ------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- rules lock -------------------------------------------------------------------
-- Structural rules become immutable once official matches exist. Everything a
-- change would silently invalidate is listed here.
create or replace function app.guard_locked_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  select rules_locked into v_locked from public.tournaments where id = new.tournament_id;

  if coalesce(v_locked, false) and (
       new.league_double_round is distinct from old.league_double_round
    or new.direct_semifinal_slots is distinct from old.direct_semifinal_slots
    or new.playoff_slots is distinct from old.playoff_slots
    or new.knockout_two_legs is distinct from old.knockout_two_legs
    or new.league_enabled is distinct from old.league_enabled
    or new.points_win is distinct from old.points_win
    or new.points_draw is distinct from old.points_draw
    or new.points_loss is distinct from old.points_loss
  ) then
    raise exception 'STRUCTURAL_RULES_LOCKED'
      using hint = 'Official matches already exist for this tournament.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tournament_rules_guard on public.tournament_rules;
create trigger tournament_rules_guard before update on public.tournament_rules
  for each row execute function app.guard_locked_rules();

-- Lock the rules the moment the first official fixture is created.
create or replace function app.lock_rules_on_first_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tournaments
     set rules_locked = true
   where id = new.tournament_id and rules_locked = false;
  return new;
end;
$$;

drop trigger if exists matches_lock_rules on public.matches;
create trigger matches_lock_rules after insert on public.matches
  for each row execute function app.lock_rules_on_first_match();

-- audit log immutability --------------------------------------------------------
create or replace function app.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_RECORD: % rows cannot be modified or deleted', tg_table_name;
end;
$$;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.block_mutation();

-- Evidence is immutable once written. A correction produces a new version and
-- only the supersede pointer may ever change.
create or replace function app.guard_evidence_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EVIDENCE_IMMUTABLE: evidence cannot be deleted';
  end if;

  if new.storage_path is distinct from old.storage_path
     or new.file_hash is distinct from old.file_hash
     or new.uploaded_by is distinct from old.uploaded_by
     or new.match_id is distinct from old.match_id
     or new.version is distinct from old.version
     or new.byte_size is distinct from old.byte_size then
    raise exception 'EVIDENCE_IMMUTABLE: only supersede markers may be updated';
  end if;

  return new;
end;
$$;

drop trigger if exists match_evidence_immutable on public.match_evidence;
create trigger match_evidence_immutable before update or delete on public.match_evidence
  for each row execute function app.guard_evidence_immutability();

-- AI extractions are an append-only record of what the model returned.
drop trigger if exists ai_extractions_immutable on public.ai_extractions;
create trigger ai_extractions_immutable before delete on public.ai_extractions
  for each row execute function app.block_mutation();

-- match evidence -> submission/status bookkeeping ------------------------------
create or replace function app.advance_match_on_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct integer;
  v_match    public.matches%rowtype;
begin
  select count(distinct uploaded_by) into v_distinct
    from public.match_evidence
   where match_id = new.match_id and superseded_at is null;

  select * into v_match from public.matches where id = new.match_id;

  if v_match.status in ('verified', 'completed', 'cancelled') then
    return new;
  end if;

  if v_distinct >= 2 then
    update public.matches set status = 'ai_verifying', updated_at = now()
     where id = new.match_id and status <> 'review_required';
  else
    update public.matches set status = 'awaiting_second_evidence', updated_at = now()
     where id = new.match_id;
  end if;

  insert into public.tournament_activity (tournament_id, kind, message, actor_id, match_id)
  values (
    v_match.tournament_id,
    'evidence_submitted',
    (select display_name from public.profiles where id = new.uploaded_by) || ' أرسل صورة المباراة',
    new.uploaded_by,
    new.match_id
  );

  insert into public.audit_logs (tournament_id, actor_id, action, entity_type, entity_id, after_state)
  values (v_match.tournament_id, new.uploaded_by, 'EVIDENCE_SUBMITTED', 'match_evidence',
          new.id::text, jsonb_build_object('match_id', new.match_id, 'version', new.version));

  return new;
end;
$$;

drop trigger if exists match_evidence_advance on public.match_evidence;
create trigger match_evidence_advance after insert on public.match_evidence
  for each row execute function app.advance_match_on_evidence();

-- Players may never insert evidence for a match they are not playing, nor for a
-- match whose result is already official. RLS covers the first; this covers the
-- second for every role including service_role.
create or replace function app.guard_evidence_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
begin
  select * into v_match from public.matches where id = new.match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if new.uploaded_by <> v_match.player_a and new.uploaded_by <> v_match.player_b then
    raise exception 'NOT_A_MATCH_PARTICIPANT';
  end if;
  if v_match.status in ('verified', 'completed', 'cancelled') then
    raise exception 'MATCH_ALREADY_OFFICIAL';
  end if;
  return new;
end;
$$;

drop trigger if exists match_evidence_guard on public.match_evidence;
create trigger match_evidence_guard before insert on public.match_evidence
  for each row execute function app.guard_evidence_insert();

-- news invalidation on result change --------------------------------------------
-- If an official score changes after publication, every article sourced from
-- that match is flagged so a stale story is never presented as current fact.
create or replace function app.invalidate_news_on_result_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.score_a is distinct from old.score_a or new.score_b is distinct from old.score_b)
     and old.score_a is not null then
    update public.news_posts
       set status = 'invalidated',
           invalidated_at = now(),
           invalidation_reason = 'تم تعديل النتيجة الرسمية للمباراة'
     where source_match_id = new.id
       and source = 'ai_reporter'
       and status in ('draft', 'published');
  end if;
  return new;
end;
$$;

drop trigger if exists matches_invalidate_news on public.matches;
create trigger matches_invalidate_news after update of score_a, score_b on public.matches
  for each row execute function app.invalidate_news_on_result_change();

-- privilege escalation guard ----------------------------------------------------
-- `is_platform_admin` is authorization state, not profile data. A user updating
-- their own row can never raise it.
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and auth.uid() is not null
     and auth.uid() = new.id then
    raise exception 'PRIVILEGE_ESCALATION_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function app.guard_profile_privileges();

-- chat message update guard ------------------------------------------------------
-- No UPDATE path may turn a human message into a trusted system message, move
-- it between rooms, or rewrite its authorship.
create or replace function app.guard_chat_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind
     or new.system_event is distinct from old.system_event
     or new.sender_id is distinct from old.sender_id
     or new.room_id is distinct from old.room_id
     or new.created_at is distinct from old.created_at then
    raise exception 'CHAT_MESSAGE_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_guard_update on public.chat_messages;
create trigger chat_messages_guard_update before update on public.chat_messages
  for each row execute function app.guard_chat_message_update();

-- tournament state machine --------------------------------------------------------
-- Validated server-side, in the database, so that no client — not even an
-- authenticated tournament admin using the REST API directly — can force a
-- tournament into a state the engine is not ready for.
create or replace function app.valid_status_transition(
  p_from public.tournament_status,
  p_to   public.tournament_status
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'draft'             then p_to in ('registration_open', 'cancelled')
    when 'registration_open' then p_to in ('registration_full', 'check_in', 'ready_for_draw', 'cancelled', 'draft')
    when 'registration_full' then p_to in ('check_in', 'ready_for_draw', 'registration_open', 'cancelled')
    when 'check_in'          then p_to in ('ready_for_draw', 'registration_full', 'cancelled')
    when 'ready_for_draw'    then p_to in ('league_active', 'playoffs', 'semifinal', 'cancelled')
    when 'league_active'     then p_to in ('playoffs', 'semifinal', 'completed', 'cancelled')
    when 'playoffs'          then p_to in ('semifinal', 'cancelled')
    when 'semifinal'         then p_to in ('final', 'cancelled')
    when 'final'             then p_to in ('completed', 'cancelled')
    when 'completed'         then false
    when 'cancelled'         then false
    else false
  end;
$$;

create or replace function app.guard_tournament_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not app.valid_status_transition(old.status, new.status) then
    raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status;
  end if;

  if new.capacity is distinct from old.capacity and old.player_count > 0 then
    raise exception 'CAPACITY_LOCKED: players are already registered';
  end if;

  return new;
end;
$$;

drop trigger if exists tournaments_guard_status on public.tournaments;
create trigger tournaments_guard_status before update on public.tournaments
  for each row execute function app.guard_tournament_status();

-- Every tournament gets its rule row and its group chat at creation time.
create or replace function app.bootstrap_tournament()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tournament_rules (tournament_id) values (new.id)
  on conflict (tournament_id) do nothing;

  insert into public.tournament_admins (tournament_id, user_id, role, granted_by)
  values (new.id, new.created_by, 'owner', new.created_by)
  on conflict do nothing;

  perform app.ensure_tournament_room(new.id);

  insert into public.audit_logs (tournament_id, actor_id, action, entity_type, entity_id, after_state)
  values (new.id, new.created_by, 'TOURNAMENT_CREATED', 'tournament', new.id::text,
          jsonb_build_object('name', new.name, 'capacity', new.capacity, 'preset', new.preset));

  return new;
end;
$$;

drop trigger if exists tournaments_bootstrap on public.tournaments;
create trigger tournaments_bootstrap after insert on public.tournaments
  for each row execute function app.bootstrap_tournament();
