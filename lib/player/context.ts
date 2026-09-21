import 'server-only';

import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import type { MatchStatus, PlayerStatus, TournamentStatus } from '@/types/database';

/**
 * Everything the portal knows about the signed-in player, read under their own
 * session.
 *
 * The portal never uses the service-role client. If a query returns nothing,
 * that is the database saying no — which is the answer the player is supposed
 * to get, and the only one that cannot be talked past.
 */

/** Tournament states where a player still has something to do. */
const LIVE_STATUSES: TournamentStatus[] = [
  'registration_open',
  'registration_full',
  'check_in',
  'ready_for_draw',
  'league_active',
  'playoffs',
  'semifinal',
  'final',
];

/** Participation states that count as being in the competition. */
const ACTIVE_PARTICIPATION: PlayerStatus[] = ['registered', 'approved', 'checked_in', 'no_show'];

export interface PlayerTournament {
  id: string;
  slug: string;
  name: string;
  status: TournamentStatus;
  accentColor: string;
  capacity: number;
  playerCount: number;
}

export interface PlayerMembership {
  participantId: string;
  status: PlayerStatus;
  checkedInAt: string | null;
  publicStatus: string | null;
  publicNote: string | null;
  statusUpdatedAt: string | null;
}

export interface PlayerRulesState {
  version: number;
  /** null = never decided against this version. */
  decision: boolean | null;
  accepted: boolean;
}

export interface PlayerContext {
  userId: string;
  displayName: string;
  avatarPath: string | null;
  tournament: PlayerTournament;
  membership: PlayerMembership;
  rules: PlayerRulesState;
  /** Every tournament this player belongs to, for the switcher. */
  alternatives: Array<{ id: string; name: string; slug: string }>;
}

export type PlayerContextResult =
  | { ok: true; context: PlayerContext }
  | { ok: false; reason: 'unauthenticated' | 'no_tournament' };

/**
 * Resolves which tournament the portal is showing.
 *
 * A player is usually in one. When they are in several, the live one wins and
 * `?t=` overrides, so a link into a finished tournament still opens it.
 */
export async function loadPlayerContext(tournamentId?: string): Promise<PlayerContextResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };

  const supabase = await createServerSupabase();

  const { data: memberships } = await supabase
    .from('tournament_players')
    .select(
      'id, tournament_id, status, checked_in_at, public_status, public_note, status_updated_at',
    )
    .eq('user_id', user.id)
    .in('status', ACTIVE_PARTICIPATION);

  if (!memberships || memberships.length === 0) return { ok: false, reason: 'no_tournament' };

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, slug, name, status, accent_color, capacity, player_count, created_at')
    .in(
      'id',
      memberships.map((m) => m.tournament_id),
    )
    .order('created_at', { ascending: false });

  if (!tournaments || tournaments.length === 0) return { ok: false, reason: 'no_tournament' };

  const chosen =
    (tournamentId ? tournaments.find((t) => t.id === tournamentId) : undefined) ??
    tournaments.find((t) => LIVE_STATUSES.includes(t.status as TournamentStatus)) ??
    tournaments[0];

  if (!chosen) return { ok: false, reason: 'no_tournament' };

  const membership = memberships.find((m) => m.tournament_id === chosen.id);
  if (!membership) return { ok: false, reason: 'no_tournament' };

  const [{ data: profile }, { data: rules }, { data: decisionRow }] = await Promise.all([
    supabase.from('profiles').select('display_name, avatar_path').eq('id', user.id).maybeSingle(),
    supabase
      .from('tournament_rules')
      .select('version')
      .eq('tournament_id', chosen.id)
      .maybeSingle(),
    supabase
      .from('tournament_rule_acceptances')
      .select('accepted, rules_version, created_at')
      .eq('tournament_id', chosen.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const version = rules?.version ?? 1;
  const decision =
    decisionRow && decisionRow.rules_version === version ? decisionRow.accepted : null;

  return {
    ok: true,
    context: {
      userId: user.id,
      displayName: profile?.display_name ?? 'لاعب',
      avatarPath: profile?.avatar_path ?? null,
      tournament: {
        id: chosen.id,
        slug: chosen.slug,
        name: chosen.name,
        status: chosen.status as TournamentStatus,
        accentColor: chosen.accent_color,
        capacity: chosen.capacity,
        playerCount: chosen.player_count,
      },
      membership: {
        participantId: membership.id,
        status: membership.status as PlayerStatus,
        checkedInAt: membership.checked_in_at,
        publicStatus: membership.public_status,
        publicNote: membership.public_note,
        statusUpdatedAt: membership.status_updated_at,
      },
      rules: { version, decision, accepted: decision === true },
      alternatives: tournaments.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
    },
  };
}

export interface PlayerMatch {
  id: string;
  stage: string;
  roundNumber: number | null;
  leg: number | null;
  status: MatchStatus;
  scoreA: number | null;
  scoreB: number | null;
  playerA: string;
  playerB: string;
  scheduledAt: string | null;
  opponentId: string;
  opponentName: string;
  opponentAvatar: string | null;
  isHome: boolean;
}

const FINISHED: MatchStatus[] = ['verified', 'completed', 'cancelled'];

/**
 * The player's own matches — which, because of the SELECT policy on `matches`,
 * is already everything they are allowed to read. No filtering happens here
 * that the database has not already done; the split below is presentation.
 */
export async function loadPlayerMatches(tournamentId: string, userId: string) {
  const supabase = await createServerSupabase();

  const { data: matches } = await supabase
    .from('matches')
    .select(
      'id, stage, round_number, leg, player_a, player_b, score_a, score_b, status, scheduled_at',
    )
    .eq('tournament_id', tournamentId)
    .or(`player_a.eq.${userId},player_b.eq.${userId}`)
    .order('round_number', { ascending: true, nullsFirst: false });

  const rows = matches ?? [];
  const opponentIds = [
    ...new Set(rows.map((m) => (m.player_a === userId ? m.player_b : m.player_a))),
  ];

  const { data: profiles } = opponentIds.length
    ? await supabase
        .from('profiles')
        .select('id, display_name, avatar_path')
        .in('id', opponentIds)
    : { data: [] };

  const decorate = (m: (typeof rows)[number]): PlayerMatch => {
    const isHome = m.player_a === userId;
    const opponentId = isHome ? m.player_b : m.player_a;
    const opponent = profiles?.find((p) => p.id === opponentId);
    return {
      id: m.id,
      stage: m.stage,
      roundNumber: m.round_number,
      leg: m.leg,
      status: m.status as MatchStatus,
      scoreA: m.score_a,
      scoreB: m.score_b,
      playerA: m.player_a,
      playerB: m.player_b,
      scheduledAt: m.scheduled_at,
      opponentId,
      opponentName: opponent?.display_name ?? 'لاعب',
      opponentAvatar: opponent?.avatar_path ?? null,
      isHome,
    };
  };

  const all = rows.map(decorate);
  const finished = all.filter((m) => FINISHED.includes(m.status));
  const open = all.filter((m) => !FINISHED.includes(m.status));

  return {
    /** The one match the player may act on. There is never more than one. */
    next: open[0] ?? null,
    finished: finished.reverse(),
    /** True when the schedule exists but the next round is still shut. */
    hasHiddenNext: open.length === 0 && finished.length > 0,
  };
}

/**
 * A single match, or null.
 *
 * The null comes from RLS: `app.player_match_unlocked()` decides, so a guessed
 * id and a locked round both return the same nothing.
 */
export async function loadPlayerMatch(matchId: string, userId: string) {
  const supabase = await createServerSupabase();

  const { data: match } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, stage, round_number, leg, player_a, player_b, score_a, score_b, status, scheduled_at, verification_note',
    )
    .eq('id', matchId)
    .maybeSingle();

  if (!match) return null;
  if (match.player_a !== userId && match.player_b !== userId) return null;

  const isHome = match.player_a === userId;
  const opponentId = isHome ? match.player_b : match.player_a;

  const { data: opponent } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_path, efootball_name, platform')
    .eq('id', opponentId)
    .maybeSingle();

  return { match, isHome, opponentId, opponent };
}
