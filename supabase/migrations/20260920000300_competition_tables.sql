-- =============================================================================
-- 0300 — League, draws, knockout ties, matches, standings snapshots
-- =============================================================================

-- -----------------------------------------------------------------------------
-- league_rounds
-- -----------------------------------------------------------------------------
create table if not exists public.league_rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_number  smallint not null,
  leg           smallint not null,
  label         text,
  starts_at     timestamptz,
  completed_at  timestamptz,
  unique (tournament_id, round_number),
  constraint league_rounds_leg check (leg in (1, 2)),
  constraint league_rounds_number check (round_number >= 1)
);

-- -----------------------------------------------------------------------------
-- draws
-- -----------------------------------------------------------------------------
create table if not exists public.draws (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  kind          public.draw_kind not null,
  seed_hash     text not null,
  executed_by   uuid not null references public.profiles (id) on delete restrict,
  executed_at   timestamptz not null default now(),
  revealed_at   timestamptz,
  payload       jsonb not null default '{}'::jsonb,
  unique (tournament_id, kind)
);

create table if not exists public.draw_entries (
  id          uuid primary key default gen_random_uuid(),
  draw_id     uuid not null references public.draws (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  pot_label   text,
  slot_index  smallint not null,
  pair_index  smallint not null,
  side        char(1) not null,
  unique (draw_id, user_id),
  unique (draw_id, slot_index),
  constraint draw_entries_side check (side in ('a', 'b'))
);

-- -----------------------------------------------------------------------------
-- knockout_ties
-- -----------------------------------------------------------------------------
create table if not exists public.knockout_ties (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  stage          public.match_stage not null,
  position       smallint not null,
  label          text,
  player_a       uuid references public.profiles (id) on delete set null,
  player_b       uuid references public.profiles (id) on delete set null,
  aggregate_a    smallint not null default 0,
  aggregate_b    smallint not null default 0,
  extra_time_a   smallint,
  extra_time_b   smallint,
  penalties_a    smallint,
  penalties_b    smallint,
  winner_id      uuid references public.profiles (id) on delete set null,
  status         public.tie_status not null default 'pending',
  two_legs       boolean not null default true,
  next_tie_id    uuid references public.knockout_ties (id) on delete set null,
  next_tie_slot  char(1),
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (tournament_id, stage, position),
  constraint ties_distinct_players check (player_a is null or player_b is null or player_a <> player_b),
  constraint ties_aggregate_nonneg check (aggregate_a >= 0 and aggregate_b >= 0),
  constraint ties_shootout_nonneg check (
    (penalties_a is null or penalties_a >= 0) and (penalties_b is null or penalties_b >= 0)
  ),
  constraint ties_next_slot check (next_tie_slot is null or next_tie_slot in ('a', 'b')),
  constraint ties_winner_is_participant check (
    winner_id is null or winner_id = player_a or winner_id = player_b
  )
);

create index if not exists knockout_ties_tournament_idx on public.knockout_ties (tournament_id, stage);

-- -----------------------------------------------------------------------------
-- matches
-- -----------------------------------------------------------------------------
create table if not exists public.matches (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references public.tournaments (id) on delete cascade,
  stage             public.match_stage not null,
  round_id          uuid references public.league_rounds (id) on delete set null,
  round_number      smallint,
  tie_id            uuid references public.knockout_ties (id) on delete cascade,
  leg               smallint not null default 1,
  player_a          uuid not null references public.profiles (id) on delete restrict,
  player_b          uuid not null references public.profiles (id) on delete restrict,
  team_a            text,
  team_b            text,
  score_a           smallint,
  score_b           smallint,
  extra_time_a      smallint,
  extra_time_b      smallint,
  penalties_a       smallint,
  penalties_b       smallint,
  winner_id         uuid references public.profiles (id) on delete set null,
  status            public.match_status not null default 'pending',
  went_to_extra_time boolean not null default false,
  went_to_penalties  boolean not null default false,
  scheduled_at      timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  verified_at       timestamptz,
  verified_by       uuid references public.profiles (id) on delete set null,
  verification_note text,
  official_source   text not null default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint matches_distinct_players check (player_a <> player_b),
  constraint matches_leg check (leg in (1, 2)),
  constraint matches_scores_nonneg check (
    (score_a is null or score_a >= 0) and (score_b is null or score_b >= 0)
  ),
  constraint matches_scores_paired check ((score_a is null) = (score_b is null)),
  constraint matches_et_nonneg check (
    (extra_time_a is null or extra_time_a >= 0) and (extra_time_b is null or extra_time_b >= 0)
  ),
  constraint matches_pens_nonneg check (
    (penalties_a is null or penalties_a >= 0) and (penalties_b is null or penalties_b >= 0)
  ),
  constraint matches_winner_is_participant check (
    winner_id is null or winner_id = player_a or winner_id = player_b
  ),
  constraint matches_league_has_round check (
    stage <> 'league' or round_number is not null
  ),
  constraint matches_knockout_has_tie check (
    stage = 'league' or tie_id is not null
  ),
  constraint matches_official_source check (
    official_source in ('pending', 'ai_verified', 'admin_override', 'walkover', 'cancelled')
  )
);

create index if not exists matches_tournament_stage_idx on public.matches (tournament_id, stage, round_number);
create index if not exists matches_tie_idx on public.matches (tie_id, leg);
create index if not exists matches_player_a_idx on public.matches (player_a);
create index if not exists matches_player_b_idx on public.matches (player_b);
create index if not exists matches_status_idx on public.matches (tournament_id, status);

-- One first leg and one second leg per tie.
create unique index if not exists matches_tie_leg_unique
  on public.matches (tie_id, leg) where tie_id is not null;

-- In a double round robin the ordered pair (home, away) is played exactly once.
create unique index if not exists matches_league_fixture_unique
  on public.matches (tournament_id, player_a, player_b) where stage = 'league';

-- -----------------------------------------------------------------------------
-- standings_snapshots — immutable history of the official table
-- -----------------------------------------------------------------------------
create table if not exists public.standings_snapshots (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_number  smallint,
  table_state   jsonb not null,
  reason        text,
  created_at    timestamptz not null default now()
);

create index if not exists standings_snapshots_tournament_idx
  on public.standings_snapshots (tournament_id, created_at desc);
