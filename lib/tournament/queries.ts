import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PlayerStatus, TournamentRulesRow } from '@/types/database';
import type { Tiebreaker, TournamentRules } from './types';
import { DEFAULT_RULES } from './presets';
import { buildStandings, splitQualification } from '@/lib/league/standings';
import type { StandingRow } from './types';

type Client = SupabaseClient<Database>;

const ACTIVE_PLAYER_STATUSES: PlayerStatus[] = [
  'registered',
  'approved',
  'checked_in',
  'no_show',
];

interface PlayerProfile {
  id: string;
  display_name: string;
  avatar_path: string | null;
}

interface PlayerWithProfile {
  user_id: string;
  status: PlayerStatus;
  profiles: PlayerProfile | null;
}

export function rulesFromRow(row: TournamentRulesRow | null): TournamentRules {
  if (!row) return { ...DEFAULT_RULES };
  return {
    matchDurationMinutes: row.match_duration_minutes,
    leagueEnabled: row.league_enabled,
    leagueDoubleRound: row.league_double_round,
    leagueExtraTime: row.league_extra_time,
    leaguePenalties: row.league_penalties,
    pointsWin: row.points_win,
    pointsDraw: row.points_draw,
    pointsLoss: row.points_loss,
    tiebreakers: row.tiebreakers as Tiebreaker[],
    directSemifinalSlots: row.direct_semifinal_slots,
    playoffSlots: row.playoff_slots,
    knockoutTwoLegs: row.knockout_two_legs,
    knockoutExtraTime: row.knockout_extra_time,
    knockoutPenalties: row.knockout_penalties,
    awayGoalsRule: row.away_goals_rule,
    semifinalDrawMode: row.semifinal_draw_mode,
    thirdPlaceMatch: row.third_place_match,
    bigWinGoalDiff: row.big_win_goal_diff,
    aiMinConfidence: Number(row.ai_min_confidence),
    aiStatisticTolerance: Number(row.ai_statistic_tolerance),
  };
}

export async function loadRules(client: Client, tournamentId: string): Promise<TournamentRules> {
  const { data } = await client
    .from('tournament_rules')
    .select('*')
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  return rulesFromRow(data);
}

export interface StandingsBundle {
  standings: StandingRow[];
  qualification: ReturnType<typeof splitQualification>;
  playersById: Map<string, PlayerProfile>;
  verifiedMatches: number;
  totalMatches: number;
}

/**
 * The official table.
 *
 * Only matches whose status is `verified` (or `completed`) contribute. Pending,
 * awaiting-evidence and disputed matches are excluded here rather than filtered
 * in the UI, so there is exactly one definition of "official" in the system.
 */
export async function loadStandings(
  client: Client,
  tournamentId: string,
): Promise<StandingsBundle> {
  const rules = await loadRules(client, tournamentId);

  const [{ data: players }, { data: matches }] = await Promise.all([
    client
      .from('tournament_players')
      .select('user_id, status, profiles:user_id (id, display_name, avatar_path)')
      .eq('tournament_id', tournamentId)
      .in('status', ACTIVE_PLAYER_STATUSES)
      .overrideTypes<PlayerWithProfile[]>(),
    client
      .from('matches')
      .select('player_a, player_b, score_a, score_b, status')
      .eq('tournament_id', tournamentId)
      .eq('stage', 'league'),
  ]);

  const playerIds = (players ?? []).map((p) => p.user_id);
  const playersById = new Map<string, PlayerProfile>();

  for (const row of players ?? []) {
    if (row.profiles) playersById.set(row.user_id, row.profiles);
  }

  const verified = (matches ?? []).filter(
    (m) =>
      (m.status === 'verified' || m.status === 'completed') &&
      m.score_a !== null &&
      m.score_b !== null,
  );

  const standings = buildStandings({
    playerIds,
    results: verified.map((m) => ({
      playerA: m.player_a,
      playerB: m.player_b,
      scoreA: m.score_a as number,
      scoreB: m.score_b as number,
    })),
    rules: {
      pointsWin: rules.pointsWin,
      pointsDraw: rules.pointsDraw,
      pointsLoss: rules.pointsLoss,
      tiebreakers: rules.tiebreakers,
      directSemifinalSlots: rules.directSemifinalSlots,
      playoffSlots: rules.playoffSlots,
    },
  });

  // A participant can no longer read the fixtures ahead of them, so counting
  // the rows they can see would report "16 of 16" where the truth is "16 of
  // 56". The totals come from a definer function that returns two numbers and
  // discloses nothing else.
  const { data: totals } = await client.rpc('tournament_match_totals', {
    p_tournament: tournamentId,
  });
  const totalRow = Array.isArray(totals) ? totals[0] : totals;

  return {
    standings,
    qualification: splitQualification(standings),
    playersById,
    verifiedMatches: totalRow?.verified ?? verified.length,
    totalMatches: totalRow?.total ?? (matches ?? []).length,
  };
}

export async function loadTournamentBySlug(client: Client, slug: string) {
  const { data } = await client.from('tournaments').select('*').eq('slug', slug).maybeSingle();
  return data;
}

export async function loadEligiblePlayerIds(
  client: Client,
  tournamentId: string,
): Promise<string[]> {
  const { data: tournament } = await client
    .from('tournaments')
    .select('check_in_opens_at')
    .eq('id', tournamentId)
    .maybeSingle();

  // When a check-in window was configured, only players who actually checked in
  // enter the official competition (§26).
  const statuses: PlayerStatus[] = tournament?.check_in_opens_at
    ? ['checked_in']
    : ['approved', 'checked_in'];

  const { data } = await client
    .from('tournament_players')
    .select('user_id, joined_at')
    .eq('tournament_id', tournamentId)
    .in('status', statuses)
    .order('joined_at', { ascending: true });

  return (data ?? []).map((row) => row.user_id);
}
