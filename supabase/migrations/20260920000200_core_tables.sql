-- =============================================================================
-- 0200 — Profiles, tournaments, rules, participation, invitations
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  display_name      text not null,
  efootball_name    text,
  efootball_id      text,
  avatar_path       text,
  platform          public.gaming_platform,
  phone             text,
  telegram_username text,
  bio               text,
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_display_name_len check (char_length(display_name) between 2 and 40),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 400)
);

create index if not exists profiles_display_name_idx on public.profiles (lower(display_name));

-- -----------------------------------------------------------------------------
-- tournaments
-- -----------------------------------------------------------------------------
create table if not exists public.tournaments (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  name                 text not null,
  description          text,
  cover_path           text,
  accent_color         text not null default '#E8FF59',
  capacity             smallint not null,
  preset               public.tournament_preset not null default 'league8_double_playoffs',
  status               public.tournament_status not null default 'draft',
  visibility           public.tournament_visibility not null default 'invite_only',
  platform             public.gaming_platform,
  prize_info           text,
  allowed_teams        text[],
  auto_approve         boolean not null default true,
  waitlist_enabled     boolean not null default false,
  ai_news_enabled      boolean not null default true,
  ai_news_mode         public.ai_news_mode not null default 'review_first',
  telegram_enabled     boolean not null default false,
  registration_opens_at  timestamptz,
  registration_closes_at timestamptz,
  check_in_opens_at    timestamptz,
  check_in_closes_at   timestamptz,
  starts_at            timestamptz,
  completed_at         timestamptz,
  champion_id          uuid references public.profiles (id) on delete set null,
  player_count         integer not null default 0,
  rules_locked         boolean not null default false,
  created_by           uuid not null references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint tournaments_capacity_allowed check (capacity in (8, 16)),
  -- Hard, database-level capacity ceiling. Combined with the row lock taken by
  -- app.sync_tournament_player_count() this makes over-registration impossible.
  constraint tournaments_player_count_within_capacity
    check (player_count >= 0 and player_count <= capacity),
  constraint tournaments_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  constraint tournaments_accent_hex check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint tournaments_registration_window
    check (
      registration_opens_at is null
      or registration_closes_at is null
      or registration_closes_at > registration_opens_at
    )
);

create index if not exists tournaments_status_idx on public.tournaments (status);
create index if not exists tournaments_visibility_status_idx on public.tournaments (visibility, status);
create index if not exists tournaments_created_by_idx on public.tournaments (created_by);

-- -----------------------------------------------------------------------------
-- tournament_admins
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_admins (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'admin',
  granted_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (tournament_id, user_id),
  constraint tournament_admins_role check (role in ('owner', 'admin', 'moderator'))
);

create index if not exists tournament_admins_user_idx on public.tournament_admins (user_id);

-- -----------------------------------------------------------------------------
-- tournament_rules  (structured rule engine configuration, one row per tournament)
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_rules (
  tournament_id          uuid primary key references public.tournaments (id) on delete cascade,
  match_duration_minutes smallint not null default 15,

  league_enabled         boolean not null default true,
  league_double_round    boolean not null default true,
  league_extra_time      boolean not null default false,
  league_penalties       boolean not null default false,
  points_win             smallint not null default 3,
  points_draw            smallint not null default 1,
  points_loss            smallint not null default 0,
  tiebreakers            text[] not null default array['points','goal_difference','goals_for','head_to_head']::text[],

  direct_semifinal_slots smallint not null default 2,
  playoff_slots          smallint not null default 4,

  knockout_two_legs      boolean not null default true,
  knockout_extra_time    boolean not null default true,
  knockout_penalties     boolean not null default true,
  away_goals_rule        boolean not null default false,
  semifinal_draw_mode    public.semifinal_draw_mode not null default 'seeded',
  third_place_match      boolean not null default false,

  big_win_goal_diff      smallint not null default 4,
  ai_min_confidence      numeric(4,3) not null default 0.850,
  ai_statistic_tolerance numeric(4,3) not null default 0.150,

  extra                  jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now(),

  constraint rules_duration check (match_duration_minutes between 4 and 90),
  constraint rules_points check (points_win >= points_draw and points_draw >= points_loss and points_loss >= 0),
  constraint rules_slots check (direct_semifinal_slots >= 0 and playoff_slots >= 0 and playoff_slots % 2 = 0),
  constraint rules_tiebreakers_nonempty check (array_length(tiebreakers, 1) >= 1),
  constraint rules_confidence check (ai_min_confidence > 0 and ai_min_confidence <= 1),
  constraint rules_tolerance check (ai_statistic_tolerance >= 0 and ai_statistic_tolerance <= 1),
  constraint rules_big_win check (big_win_goal_diff >= 1)
);

-- -----------------------------------------------------------------------------
-- tournament_players
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_players (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  status         public.player_status not null default 'registered',
  seed           smallint,
  team_name      text,
  joined_at      timestamptz not null default now(),
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  checked_in_at  timestamptz,
  removed_at     timestamptz,
  removal_reason text,
  invite_id      uuid,
  unique (tournament_id, user_id),
  unique (tournament_id, seed) deferrable initially deferred
);

create index if not exists tournament_players_tournament_idx
  on public.tournament_players (tournament_id, status);
create index if not exists tournament_players_user_idx on public.tournament_players (user_id);

-- -----------------------------------------------------------------------------
-- tournament_invites
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_invites (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  label          text,
  token          text not null unique,
  code           text not null,
  max_uses       integer,
  used_count     integer not null default 0,
  auto_approve   boolean not null default true,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_by     uuid not null references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  unique (tournament_id, code),
  constraint invites_uses check (used_count >= 0 and (max_uses is null or used_count <= max_uses)),
  constraint invites_max_uses check (max_uses is null or max_uses > 0),
  -- 32 url-safe chars of CSPRNG output; never derived from a row id.
  constraint invites_token_strength check (char_length(token) >= 24),
  constraint invites_code_shape check (code ~ '^[A-Z0-9-]{4,16}$')
);

create index if not exists tournament_invites_tournament_idx
  on public.tournament_invites (tournament_id) where revoked_at is null;

alter table public.tournament_players
  drop constraint if exists tournament_players_invite_fk;
alter table public.tournament_players
  add constraint tournament_players_invite_fk
  foreign key (invite_id) references public.tournament_invites (id) on delete set null;

-- -----------------------------------------------------------------------------
-- invite_redemptions
-- -----------------------------------------------------------------------------
create table if not exists public.invite_redemptions (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.tournament_invites (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (invite_id, user_id)
);

-- -----------------------------------------------------------------------------
-- tournament_waitlist
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_waitlist (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  position      integer not null,
  created_at    timestamptz not null default now(),
  promoted_at   timestamptz,
  unique (tournament_id, user_id)
);

-- -----------------------------------------------------------------------------
-- audit_logs — append-only from the point of view of every non-service role
--
-- `tournament_id` and `actor_id` carry no foreign key on purpose. The log is a
-- ledger that must outlive the rows it describes: an ON DELETE SET NULL would
-- be an UPDATE, which the immutability trigger (correctly) refuses, making the
-- referenced rows undeletable and silently rewriting history if it did not.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id            bigint generated always as identity primary key,
  tournament_id uuid,
  actor_id      uuid,
  action        text not null,
  entity_type   text,
  entity_id     text,
  reason        text,
  before_state  jsonb,
  after_state   jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_logs_tournament_idx on public.audit_logs (tournament_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
