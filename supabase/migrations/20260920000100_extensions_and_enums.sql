-- =============================================================================
-- EFootball Tournament Platform
-- 0100 — Extensions, private schema, enumerated types
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- Private schema for trusted helper functions. It is NOT added to the
-- PostgREST exposed-schema list, so nothing here is callable from the browser.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tournament lifecycle
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.tournament_status as enum (
    'draft',
    'registration_open',
    'registration_full',
    'check_in',
    'ready_for_draw',
    'league_active',
    'playoffs',
    'semifinal',
    'final',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tournament_visibility as enum ('public', 'invite_only');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tournament_preset as enum (
    'league8_double_playoffs',
    'league8_double',
    'knockout8',
    'knockout16',
    'groups_knockout',
    'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.semifinal_draw_mode as enum ('seeded', 'open_draw');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ai_news_mode as enum ('review_first', 'automatic');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Participation
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.player_status as enum (
    'registered',
    'approved',
    'checked_in',
    'no_show',
    'withdrawn',
    'rejected',
    'disqualified'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gaming_platform as enum (
    'ps5', 'ps4', 'xbox', 'pc', 'mobile', 'other'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Competition
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.match_stage as enum (
    'league', 'playoff', 'semifinal', 'third_place', 'final'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_status as enum (
    'pending',
    'ready',
    'live',
    'awaiting_first_evidence',
    'awaiting_second_evidence',
    'ai_verifying',
    'awaiting_verification',
    'review_required',
    'verified',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tie_status as enum (
    'pending', 'first_leg', 'second_leg', 'extra_time', 'penalties', 'completed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.draw_kind as enum ('playoff', 'semifinal', 'final');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Evidence / verification
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.extraction_status as enum (
    'queued', 'running', 'succeeded', 'failed', 'invalid_output'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_case_status as enum ('open', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_reason as enum (
    'score_mismatch',
    'identity_mismatch',
    'team_mismatch',
    'statistics_mismatch',
    'low_confidence',
    'invalid_result_screen',
    'unreadable_evidence',
    'ai_unavailable',
    'correction_request',
    'admin_opened'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Community
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.news_source as enum ('player', 'ai_reporter', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.news_status as enum ('draft', 'published', 'archived', 'invalidated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.news_label as enum (
    'MATCH_REPORT', 'BREAKING', 'BIG_WIN', 'QUALIFIED', 'DRAW',
    'PLAYOFF', 'FINAL', 'CHAMPION', 'PLAYER_POST', 'STANDINGS'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_room_type as enum ('tournament_group', 'direct');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_message_kind as enum ('user', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_target as enum ('news_post', 'chat_message', 'profile');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_status as enum ('open', 'ignored', 'actioned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.outbox_status as enum ('pending', 'sent', 'failed');
exception when duplicate_object then null; end $$;
