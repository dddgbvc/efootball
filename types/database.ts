/**
 * Database types for the EFootball Supabase project.
 *
 * Regenerate after any migration with:
 *   npx supabase gen types typescript --project-id <ref> > types/database.ts
 *
 * The hand-maintained version below mirrors supabase/migrations/* exactly and
 * keeps the app type-safe before the generated file is available.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type TournamentStatus =
  | 'draft'
  | 'registration_open'
  | 'registration_full'
  | 'check_in'
  | 'ready_for_draw'
  | 'league_active'
  | 'playoffs'
  | 'semifinal'
  | 'final'
  | 'completed'
  | 'cancelled';

export type TournamentVisibility = 'public' | 'invite_only';
export type TournamentPresetEnum =
  | 'league8_double_playoffs'
  | 'league8_double'
  | 'knockout8'
  | 'knockout16'
  | 'groups_knockout'
  | 'custom';
export type SemifinalDrawModeEnum = 'seeded' | 'open_draw';
export type AiNewsMode = 'review_first' | 'automatic';
export type PlayerStatus =
  | 'registered'
  | 'approved'
  | 'checked_in'
  | 'no_show'
  | 'withdrawn'
  | 'rejected'
  | 'disqualified';
export type GamingPlatform = 'ps5' | 'ps4' | 'xbox' | 'pc' | 'mobile' | 'other';
export type MatchStageEnum = 'league' | 'playoff' | 'semifinal' | 'third_place' | 'final';
export type MatchStatus =
  | 'pending'
  | 'ready'
  | 'live'
  | 'awaiting_first_evidence'
  | 'awaiting_second_evidence'
  | 'ai_verifying'
  | 'awaiting_verification'
  | 'review_required'
  | 'verified'
  | 'completed'
  | 'cancelled';
export type TieStatus =
  | 'pending'
  | 'first_leg'
  | 'second_leg'
  | 'extra_time'
  | 'penalties'
  | 'completed';
export type DrawKind = 'playoff' | 'semifinal' | 'final';
export type ExtractionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'invalid_output';
export type VerificationCaseStatus = 'open' | 'resolved' | 'dismissed';
export type VerificationReasonEnum =
  | 'score_mismatch'
  | 'identity_mismatch'
  | 'team_mismatch'
  | 'statistics_mismatch'
  | 'low_confidence'
  | 'invalid_result_screen'
  | 'unreadable_evidence'
  | 'ai_unavailable'
  | 'correction_request'
  | 'admin_opened';
export type NewsSource = 'player' | 'ai_reporter' | 'system';
export type NewsStatus = 'draft' | 'published' | 'archived' | 'invalidated';
export type NewsLabel =
  | 'MATCH_REPORT'
  | 'BREAKING'
  | 'BIG_WIN'
  | 'QUALIFIED'
  | 'DRAW'
  | 'PLAYOFF'
  | 'FINAL'
  | 'CHAMPION'
  | 'PLAYER_POST'
  | 'STANDINGS';
export type ChatRoomType = 'tournament_group' | 'direct';
export type ChatMessageKind = 'user' | 'system';
export type ReportTarget = 'news_post' | 'chat_message' | 'profile';
export type ReportStatus = 'open' | 'ignored' | 'actioned';
export type OutboxStatus = 'pending' | 'sent' | 'failed';

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Omit<Row, Required>> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ProfileRow = {
  id: string;
  full_name: string | null;
  display_name: string;
  efootball_name: string | null;
  efootball_id: string | null;
  avatar_path: string | null;
  platform: GamingPlatform | null;
  phone: string | null;
  telegram_username: string | null;
  bio: string | null;
  is_platform_admin: boolean;
  created_at: string;
  updated_at: string;
}

export type TournamentRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cover_path: string | null;
  accent_color: string;
  capacity: number;
  preset: TournamentPresetEnum;
  status: TournamentStatus;
  visibility: TournamentVisibility;
  platform: GamingPlatform | null;
  prize_info: string | null;
  allowed_teams: string[] | null;
  auto_approve: boolean;
  waitlist_enabled: boolean;
  ai_news_enabled: boolean;
  ai_news_mode: AiNewsMode;
  telegram_enabled: boolean;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
  starts_at: string | null;
  completed_at: string | null;
  champion_id: string | null;
  player_count: number;
  rules_locked: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type TournamentRulesRow = {
  tournament_id: string;
  match_duration_minutes: number;
  league_enabled: boolean;
  league_double_round: boolean;
  league_extra_time: boolean;
  league_penalties: boolean;
  points_win: number;
  points_draw: number;
  points_loss: number;
  tiebreakers: string[];
  direct_semifinal_slots: number;
  playoff_slots: number;
  knockout_two_legs: boolean;
  knockout_extra_time: boolean;
  knockout_penalties: boolean;
  away_goals_rule: boolean;
  semifinal_draw_mode: SemifinalDrawModeEnum;
  third_place_match: boolean;
  big_win_goal_diff: number;
  ai_min_confidence: number;
  ai_statistic_tolerance: number;
  extra: Json;
  updated_at: string;
  version: number;
  custom_text: string | null;
}

export type TournamentPlayerRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  status: PlayerStatus;
  seed: number | null;
  team_name: string | null;
  joined_at: string;
  approved_at: string | null;
  approved_by: string | null;
  checked_in_at: string | null;
  removed_at: string | null;
  removal_reason: string | null;
  public_status: string | null;
  public_note: string | null;
  status_updated_by: string | null;
  status_updated_at: string | null;
}

export type TournamentAdminRow = {
  tournament_id: string;
  user_id: string;
  role: string;
  granted_by: string | null;
  created_at: string;
}

export type TournamentRuleAcceptanceRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  rules_version: number;
  accepted: boolean;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type TournamentJoinCodeRow = {
  tournament_id: string;
  code: string;
  rotated_by: string | null;
  rotated_at: string;
}

export type TournamentJoinRequestRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  status: JoinRequestStatus;
  message: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export type PlayerAdminNoteRow = {
  tournament_id: string;
  user_id: string;
  note: string;
  updated_by: string | null;
  updated_at: string;
}

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  failed_at: string | null;
}

export type LeagueRoundRow = {
  id: string;
  tournament_id: string;
  round_number: number;
  leg: number;
  label: string | null;
  starts_at: string | null;
  completed_at: string | null;
}

export type KnockoutTieRow = {
  id: string;
  tournament_id: string;
  stage: MatchStageEnum;
  position: number;
  label: string | null;
  player_a: string | null;
  player_b: string | null;
  aggregate_a: number;
  aggregate_b: number;
  extra_time_a: number | null;
  extra_time_b: number | null;
  penalties_a: number | null;
  penalties_b: number | null;
  winner_id: string | null;
  status: TieStatus;
  two_legs: boolean;
  next_tie_id: string | null;
  next_tie_slot: string | null;
  completed_at: string | null;
  created_at: string;
}

export type MatchRow = {
  id: string;
  tournament_id: string;
  stage: MatchStageEnum;
  round_id: string | null;
  round_number: number | null;
  tie_id: string | null;
  leg: number;
  player_a: string;
  player_b: string;
  team_a: string | null;
  team_b: string | null;
  score_a: number | null;
  score_b: number | null;
  extra_time_a: number | null;
  extra_time_b: number | null;
  penalties_a: number | null;
  penalties_b: number | null;
  winner_id: string | null;
  status: MatchStatus;
  went_to_extra_time: boolean;
  went_to_penalties: boolean;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verification_note: string | null;
  official_source: string;
  created_at: string;
  updated_at: string;
}

export type MatchSubmissionRow = {
  id: string;
  match_id: string;
  user_id: string;
  current_version: number;
  reopened_count: number;
  claimed_score_a: number | null;
  claimed_score_b: number | null;
  submitted_at: string;
}

export type MatchEvidenceRow = {
  id: string;
  match_id: string;
  submission_id: string;
  uploaded_by: string;
  storage_path: string;
  file_hash: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  version: number;
  superseded_at: string | null;
  superseded_by: string | null;
  created_at: string;
}

export type AiExtractionRow = {
  id: string;
  match_id: string;
  evidence_id: string;
  provider: string;
  model: string;
  status: ExtractionStatus;
  valid_result_screen: boolean | null;
  player_a_name: string | null;
  player_b_name: string | null;
  team_a_name: string | null;
  team_b_name: string | null;
  team_a_logo_detected: boolean | null;
  team_b_logo_detected: boolean | null;
  score_a: number | null;
  score_b: number | null;
  statistics: Json;
  confidence_overall: number | null;
  confidence_score: number | null;
  confidence_identity: number | null;
  confidence_stats: number | null;
  raw_response: Json | null;
  error_message: string | null;
  attempt: number;
  created_at: string;
  completed_at: string | null;
}

export type VerificationRunRow = {
  id: string;
  match_id: string;
  idempotency_key: string;
  extraction_a: string | null;
  extraction_b: string | null;
  outcome: string;
  reasons: string[];
  agreed_score_a: number | null;
  agreed_score_b: number | null;
  detail: Json;
  created_at: string;
}

export type VerificationCaseRow = {
  id: string;
  tournament_id: string;
  match_id: string;
  status: VerificationCaseStatus;
  reason: VerificationReasonEnum;
  detail: Json;
  opened_by: string | null;
  opened_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution: string | null;
  resolution_reason: string | null;
}

export type NewsPostRow = {
  id: string;
  tournament_id: string;
  source: NewsSource;
  label: NewsLabel;
  author_id: string | null;
  title: string | null;
  body: string;
  status: NewsStatus;
  pinned: boolean;
  source_match_id: string | null;
  facts: Json;
  event_key: string | null;
  approved_by: string | null;
  published_at: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type ChatRoomRow = {
  id: string;
  type: ChatRoomType;
  tournament_id: string | null;
  title: string | null;
  dm_key: string | null;
  created_at: string;
}

export type ChatMessageRow = {
  id: string;
  room_id: string;
  sender_id: string | null;
  kind: ChatMessageKind;
  body: string | null;
  reply_to_id: string | null;
  pinned: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  system_event: string | null;
  created_at: string;
}

export type NotificationRow = {
  id: string;
  user_id: string;
  tournament_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  event_key: string | null;
  read_at: string | null;
  created_at: string;
}

export type TelegramConnectionRow = {
  id: string;
  user_id: string;
  chat_id: number | null;
  username: string | null;
  link_token: string | null;
  token_expires_at: string | null;
  linked_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export type TelegramOutboxRow = {
  id: string;
  tournament_id: string | null;
  event_key: string;
  chat_id: number;
  text_body: string;
  reply_markup: Json | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export type AuditLogRow = {
  id: number;
  tournament_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  reason: string | null;
  before_state: Json | null;
  after_state: Json | null;
  created_at: string;
}

export type TournamentActivityRow = {
  id: number;
  tournament_id: string;
  kind: string;
  message: string;
  link: string | null;
  actor_id: string | null;
  match_id: string | null;
  created_at: string;
}

export type DrawRow = {
  id: string;
  tournament_id: string;
  kind: DrawKind;
  seed_hash: string;
  executed_by: string;
  executed_at: string;
  revealed_at: string | null;
  payload: Json;
}

export type DrawEntryRow = {
  id: string;
  draw_id: string;
  user_id: string;
  pot_label: string | null;
  slot_index: number;
  pair_index: number;
  side: string;
}

export type ModerationReportRow = {
  id: string;
  tournament_id: string | null;
  target: ReportTarget;
  target_id: string;
  reporter_id: string;
  reported_user: string | null;
  reason: string;
  status: ReportStatus;
  handled_by: string | null;
  handled_at: string | null;
  action_taken: string | null;
  created_at: string;
}

export type CorrectionRequestRow = {
  id: string;
  match_id: string;
  requested_by: string;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export type StandingsSnapshotRow = {
  id: string;
  tournament_id: string;
  round_number: number | null;
  table_state: Json;
  reason: string | null;
  created_at: string;
}

export type ChatRoomMemberRow = {
  room_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

export type ChatReadStateRow = {
  room_id: string;
  user_id: string;
  last_read_at: string;
  last_read_message_id: string | null;
}

export type ChatAttachmentRow = {
  id: string;
  message_id: string;
  room_id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, 'id' | 'display_name'>;
      tournaments: Table<TournamentRow, 'slug' | 'name' | 'capacity' | 'created_by'>;
      tournament_admins: Table<TournamentAdminRow, 'tournament_id' | 'user_id'>;
      tournament_rules: Table<TournamentRulesRow, 'tournament_id'>;
      tournament_players: Table<TournamentPlayerRow, 'tournament_id' | 'user_id'>;
      tournament_waitlist: Table<
        { id: string; tournament_id: string; user_id: string; position: number; created_at: string; promoted_at: string | null },
        'tournament_id' | 'user_id' | 'position'
      >;
      league_rounds: Table<LeagueRoundRow, 'tournament_id' | 'round_number' | 'leg'>;
      knockout_ties: Table<KnockoutTieRow, 'tournament_id' | 'stage' | 'position'>;
      matches: Table<MatchRow, 'tournament_id' | 'stage' | 'player_a' | 'player_b'>;
      match_submissions: Table<MatchSubmissionRow, 'match_id' | 'user_id'>;
      match_evidence: Table<
        MatchEvidenceRow,
        'match_id' | 'submission_id' | 'uploaded_by' | 'storage_path' | 'file_hash' | 'mime_type' | 'byte_size'
      >;
      ai_extractions: Table<AiExtractionRow, 'match_id' | 'evidence_id' | 'provider' | 'model'>;
      verification_runs: Table<VerificationRunRow, 'match_id' | 'idempotency_key' | 'outcome'>;
      verification_cases: Table<VerificationCaseRow, 'tournament_id' | 'match_id' | 'reason'>;
      evidence_correction_requests: Table<CorrectionRequestRow, 'match_id' | 'requested_by' | 'reason'>;
      standings_snapshots: Table<StandingsSnapshotRow, 'tournament_id' | 'table_state'>;
      draws: Table<DrawRow, 'tournament_id' | 'kind' | 'seed_hash' | 'executed_by'>;
      draw_entries: Table<DrawEntryRow, 'draw_id' | 'user_id' | 'slot_index' | 'pair_index' | 'side'>;
      news_posts: Table<NewsPostRow, 'tournament_id' | 'source' | 'body'>;
      news_post_media: Table<
        { id: string; post_id: string; storage_path: string; mime_type: string; byte_size: number; created_at: string },
        'post_id' | 'storage_path' | 'mime_type' | 'byte_size'
      >;
      news_reactions: Table<
        { post_id: string; user_id: string; emoji: string; created_at: string },
        'post_id' | 'user_id' | 'emoji'
      >;
      news_reports: Table<
        { id: string; post_id: string; reporter_id: string; reason: string; created_at: string },
        'post_id' | 'reporter_id' | 'reason'
      >;
      chat_rooms: Table<ChatRoomRow, 'type'>;
      chat_room_members: Table<ChatRoomMemberRow, 'room_id' | 'user_id'>;
      chat_messages: Table<ChatMessageRow, 'room_id'>;
      chat_message_attachments: Table<
        ChatAttachmentRow,
        'message_id' | 'room_id' | 'storage_path' | 'mime_type' | 'byte_size'
      >;
      chat_reactions: Table<
        { message_id: string; user_id: string; emoji: string; created_at: string },
        'message_id' | 'user_id' | 'emoji'
      >;
      chat_read_state: Table<ChatReadStateRow, 'room_id' | 'user_id'>;
      chat_mutes: Table<
        { room_id: string; user_id: string; muted_until: string | null; muted_by: string | null; reason: string | null; created_at: string },
        'room_id' | 'user_id'
      >;
      player_blocks: Table<
        { blocker_id: string; blocked_id: string; created_at: string },
        'blocker_id' | 'blocked_id'
      >;
      notifications: Table<NotificationRow, 'user_id' | 'type' | 'title'>;
      telegram_connections: Table<TelegramConnectionRow, 'user_id'>;
      telegram_outbox: Table<TelegramOutboxRow, 'event_key' | 'chat_id' | 'text_body'>;
      telegram_updates: Table<
        { update_id: number; received_at: string; payload: Json },
        'update_id' | 'payload'
      >;
      moderation_reports: Table<
        ModerationReportRow,
        'target' | 'target_id' | 'reporter_id' | 'reason'
      >;
      audit_logs: Table<AuditLogRow, 'action'>;
      tournament_activity: Table<TournamentActivityRow, 'tournament_id' | 'kind' | 'message'>;
      tournament_rule_acceptances: Table<
        TournamentRuleAcceptanceRow,
        'tournament_id' | 'user_id' | 'rules_version' | 'accepted'
      >;
      player_admin_notes: Table<PlayerAdminNoteRow, 'tournament_id' | 'user_id' | 'note'>;
      tournament_join_codes: Table<TournamentJoinCodeRow, 'tournament_id' | 'code'>;
      tournament_join_requests: Table<TournamentJoinRequestRow, 'tournament_id' | 'user_id'>;
      push_subscriptions: Table<
        PushSubscriptionRow,
        'user_id' | 'endpoint' | 'p256dh' | 'auth_secret'
      >;
    };
    Views: Record<string, never>;
    Functions: {
      check_in_tournament: {
        Args: { p_tournament_id: string };
        Returns: Json;
      };
      open_direct_room: {
        Args: { p_other_user: string };
        Returns: Json;
      };
      mark_room_read: {
        Args: { p_room_id: string; p_message_id?: string | null };
        Returns: Json;
      };
      apply_official_result: {
        Args: {
          p_match_id: string;
          p_score_a: number;
          p_score_b: number;
          p_source: string;
          p_actor?: string | null;
          p_note?: string | null;
          p_extra_time_a?: number | null;
          p_extra_time_b?: number | null;
          p_penalties_a?: number | null;
          p_penalties_b?: number | null;
        };
        Returns: Json;
      };
      post_system_message: {
        Args: { p_tournament_id: string; p_body: string; p_event?: string | null };
        Returns: Json;
      };
      tournament_match_totals: {
        Args: { p_tournament: string };
        Returns: { total: number; verified: number }[];
      };
      find_tournament_by_code: {
        Args: { p_code: string };
        Returns: Json;
      };
      approve_join_request: {
        Args: { p_request_id: string };
        Returns: Json;
      };
      reject_join_request: {
        Args: { p_request_id: string; p_note?: string | null };
        Returns: Json;
      };
      rotate_join_code: {
        Args: { p_tournament_id: string };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
