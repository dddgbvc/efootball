-- =============================================================================
-- 0400 — Dual screenshot evidence, AI extractions, verification cases
-- =============================================================================

-- -----------------------------------------------------------------------------
-- match_submissions — one row per (match, participant). Tracks the current
-- accepted evidence version for that participant.
-- -----------------------------------------------------------------------------
create table if not exists public.match_submissions (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  current_version smallint not null default 1,
  reopened_count  smallint not null default 0,
  claimed_score_a smallint,
  claimed_score_b smallint,
  submitted_at    timestamptz not null default now(),
  unique (match_id, user_id),
  constraint submissions_claimed_nonneg check (
    (claimed_score_a is null or claimed_score_a >= 0)
    and (claimed_score_b is null or claimed_score_b >= 0)
  )
);

create index if not exists match_submissions_match_idx on public.match_submissions (match_id);

-- -----------------------------------------------------------------------------
-- match_evidence — immutable. A correction creates a new version; the previous
-- row is retained and marked superseded.
-- -----------------------------------------------------------------------------
create table if not exists public.match_evidence (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  submission_id   uuid not null references public.match_submissions (id) on delete cascade,
  uploaded_by     uuid not null references public.profiles (id) on delete restrict,
  storage_path    text not null unique,
  file_hash       text not null,
  mime_type       text not null,
  byte_size       integer not null,
  width           integer,
  height          integer,
  version         smallint not null default 1,
  superseded_at   timestamptz,
  superseded_by   uuid references public.match_evidence (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (match_id, uploaded_by, version),
  constraint evidence_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint evidence_size check (byte_size > 0 and byte_size <= 10485760),
  constraint evidence_hash check (char_length(file_hash) = 64)
);

create index if not exists match_evidence_match_idx on public.match_evidence (match_id)
  where superseded_at is null;

-- -----------------------------------------------------------------------------
-- ai_extractions — one row per AI vision pass over a piece of evidence
-- -----------------------------------------------------------------------------
create table if not exists public.ai_extractions (
  id                   uuid primary key default gen_random_uuid(),
  match_id             uuid not null references public.matches (id) on delete cascade,
  evidence_id          uuid not null references public.match_evidence (id) on delete cascade,
  provider             text not null,
  model                text not null,
  status               public.extraction_status not null default 'queued',
  valid_result_screen  boolean,
  player_a_name        text,
  player_b_name        text,
  team_a_name          text,
  team_b_name          text,
  team_a_logo_detected boolean,
  team_b_logo_detected boolean,
  score_a              smallint,
  score_b              smallint,
  statistics           jsonb not null default '{}'::jsonb,
  confidence_overall   numeric(4,3),
  confidence_score     numeric(4,3),
  confidence_identity  numeric(4,3),
  confidence_stats     numeric(4,3),
  raw_response         jsonb,
  error_message        text,
  attempt              smallint not null default 1,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  unique (evidence_id, attempt),
  constraint extraction_scores_nonneg check (
    (score_a is null or score_a >= 0) and (score_b is null or score_b >= 0)
  ),
  constraint extraction_conf_range check (
    (confidence_overall is null or (confidence_overall >= 0 and confidence_overall <= 1))
    and (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
    and (confidence_identity is null or (confidence_identity >= 0 and confidence_identity <= 1))
    and (confidence_stats is null or (confidence_stats >= 0 and confidence_stats <= 1))
  )
);

create index if not exists ai_extractions_match_idx on public.ai_extractions (match_id, created_at desc);

-- -----------------------------------------------------------------------------
-- verification_runs — idempotent cross-verification of a pair of extractions
-- -----------------------------------------------------------------------------
create table if not exists public.verification_runs (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  idempotency_key text not null unique,
  extraction_a    uuid references public.ai_extractions (id) on delete set null,
  extraction_b    uuid references public.ai_extractions (id) on delete set null,
  outcome         text not null,
  reasons         text[] not null default '{}',
  agreed_score_a  smallint,
  agreed_score_b  smallint,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint verification_outcome check (outcome in ('verified', 'review_required', 'deferred'))
);

create index if not exists verification_runs_match_idx on public.verification_runs (match_id, created_at desc);

-- -----------------------------------------------------------------------------
-- verification_cases — the human dispute queue
-- -----------------------------------------------------------------------------
create table if not exists public.verification_cases (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  match_id      uuid not null references public.matches (id) on delete cascade,
  status        public.verification_case_status not null default 'open',
  reason        public.verification_reason not null,
  detail        jsonb not null default '{}'::jsonb,
  opened_by     uuid references public.profiles (id) on delete set null,
  opened_at     timestamptz not null default now(),
  resolved_by   uuid references public.profiles (id) on delete set null,
  resolved_at   timestamptz,
  resolution    text,
  resolution_reason text
);

create unique index if not exists verification_cases_one_open_per_match
  on public.verification_cases (match_id) where status = 'open';
create index if not exists verification_cases_tournament_idx
  on public.verification_cases (tournament_id, status);

-- -----------------------------------------------------------------------------
-- evidence_correction_requests
-- -----------------------------------------------------------------------------
create table if not exists public.evidence_correction_requests (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  reason       text not null,
  status       text not null default 'pending',
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now(),
  constraint correction_status check (status in ('pending', 'approved', 'rejected')),
  constraint correction_reason_len check (char_length(reason) between 5 and 500)
);

create unique index if not exists correction_one_pending_per_player
  on public.evidence_correction_requests (match_id, requested_by) where status = 'pending';
