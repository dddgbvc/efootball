import type {
  LeagueResult,
  QualificationZone,
  StandingRow,
  Tiebreaker,
  TournamentRules,
} from '@/lib/tournament/types';

interface Accumulator {
  playerId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export interface StandingsInput {
  playerIds: string[];
  /** ONLY verified official results. Pending or disputed matches must not be passed in. */
  results: LeagueResult[];
  rules: Pick<TournamentRules, 'pointsWin' | 'pointsDraw' | 'pointsLoss' | 'tiebreakers'> &
    Partial<Pick<TournamentRules, 'directSemifinalSlots' | 'playoffSlots'>>;
}

/**
 * Builds the official league table from verified results only.
 *
 * Tie-break order is configurable. `head_to_head` is evaluated against the
 * mini-table formed by the currently tied group, which is the reason the chain
 * is applied group-wise rather than as a flat comparator.
 */
export function buildStandings(input: StandingsInput): StandingRow[] {
  const { playerIds, results, rules } = input;
  const table = new Map<string, Accumulator>();

  for (const id of playerIds) {
    table.set(id, {
      playerId: id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      form: [],
    });
  }

  for (const result of results) {
    const a = table.get(result.playerA);
    const b = table.get(result.playerB);
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;
    a.goalsFor += result.scoreA;
    a.goalsAgainst += result.scoreB;
    b.goalsFor += result.scoreB;
    b.goalsAgainst += result.scoreA;

    if (result.scoreA > result.scoreB) {
      a.won += 1;
      b.lost += 1;
      a.points += rules.pointsWin;
      b.points += rules.pointsLoss;
      a.form.push('W');
      b.form.push('L');
    } else if (result.scoreB > result.scoreA) {
      b.won += 1;
      a.lost += 1;
      b.points += rules.pointsWin;
      a.points += rules.pointsLoss;
      b.form.push('W');
      a.form.push('L');
    } else {
      a.drawn += 1;
      b.drawn += 1;
      a.points += rules.pointsDraw;
      b.points += rules.pointsDraw;
      a.form.push('D');
      b.form.push('D');
    }
  }

  const ordered = orderByTiebreakers([...table.values()], results, rules.tiebreakers);

  const directSlots = rules.directSemifinalSlots ?? 0;
  const playoffSlots = rules.playoffSlots ?? 0;

  return ordered.map((entry, index) => ({
    playerId: entry.row.playerId,
    position: index + 1,
    played: entry.row.played,
    won: entry.row.won,
    drawn: entry.row.drawn,
    lost: entry.row.lost,
    goalsFor: entry.row.goalsFor,
    goalsAgainst: entry.row.goalsAgainst,
    goalDifference: entry.row.goalsFor - entry.row.goalsAgainst,
    points: entry.row.points,
    form: entry.row.form.slice(-5),
    zone: zoneForPosition(index + 1, directSlots, playoffSlots),
    tiedWith: entry.tiedWith,
  }));
}

export function zoneForPosition(
  position: number,
  directSemifinalSlots: number,
  playoffSlots: number,
): QualificationZone {
  if (directSemifinalSlots === 0 && playoffSlots === 0) return 'none';
  if (position <= directSemifinalSlots) return 'direct_semifinal';
  if (position <= directSemifinalSlots + playoffSlots) return 'playoff';
  return 'eliminated';
}

interface OrderedEntry {
  row: Accumulator;
  /**
   * Players this row could not be separated from by the configured chain. A
   * non-empty list is what the rules call a "configured fallback / manual
   * playoff" case, and the UI surfaces it instead of inventing an order.
   */
  tiedWith: string[];
}

function orderByTiebreakers(
  rows: Accumulator[],
  results: LeagueResult[],
  chain: Tiebreaker[],
): OrderedEntry[] {
  const sorted = resolveGroup(rows, results, chain, 0);
  return sorted;
}

function resolveGroup(
  rows: Accumulator[],
  results: LeagueResult[],
  chain: Tiebreaker[],
  depth: number,
): OrderedEntry[] {
  if (rows.length <= 1) {
    return rows.map((row) => ({ row, tiedWith: [] }));
  }
  if (depth >= chain.length) {
    // Still level after the whole chain: keep a stable, explicit ordering and
    // record the tie so it can be resolved by a human.
    const ids = rows.map((r) => r.playerId).sort();
    return [...rows]
      .sort((a, b) => a.playerId.localeCompare(b.playerId))
      .map((row) => ({ row, tiedWith: ids.filter((id) => id !== row.playerId) }));
  }

  const criterion = chain[depth]!;
  const groupIds = new Set(rows.map((r) => r.playerId));
  const scored = rows.map((row) => ({ row, score: scoreFor(row, criterion, results, groupIds) }));
  scored.sort((a, b) => b.score - a.score);

  const out: OrderedEntry[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i + 1;
    while (j < scored.length && scored[j]!.score === scored[i]!.score) j += 1;

    const bucket = scored.slice(i, j).map((s) => s.row);
    if (bucket.length === 1) {
      out.push({ row: bucket[0]!, tiedWith: [] });
    } else if (bucket.length === rows.length) {
      // This criterion separated nothing; move straight to the next one.
      out.push(...resolveGroup(bucket, results, chain, depth + 1));
    } else {
      // A smaller tied group restarts the chain, so head-to-head is always
      // computed over the right mini-table.
      out.push(...resolveGroup(bucket, results, chain, criterion === 'head_to_head' ? depth + 1 : 0));
    }
    i = j;
  }

  return out;
}

function scoreFor(
  row: Accumulator,
  criterion: Tiebreaker,
  results: LeagueResult[],
  groupIds: Set<string>,
): number {
  switch (criterion) {
    case 'points':
      return row.points;
    case 'goal_difference':
      return row.goalsFor - row.goalsAgainst;
    case 'goals_for':
      return row.goalsFor;
    case 'goals_against':
      return -row.goalsAgainst;
    case 'wins':
      return row.won;
    case 'head_to_head':
      return headToHeadScore(row.playerId, results, groupIds);
  }
}

/**
 * Head-to-head mini-table score: points earned in matches played exclusively
 * between the currently tied players, with goal difference as a fractional
 * refinement so a single number can express both.
 */
function headToHeadScore(
  playerId: string,
  results: LeagueResult[],
  groupIds: Set<string>,
): number {
  let points = 0;
  let goalDiff = 0;

  for (const r of results) {
    if (!groupIds.has(r.playerA) || !groupIds.has(r.playerB)) continue;
    if (r.playerA !== playerId && r.playerB !== playerId) continue;

    const isA = r.playerA === playerId;
    const own = isA ? r.scoreA : r.scoreB;
    const other = isA ? r.scoreB : r.scoreA;

    goalDiff += own - other;
    if (own > other) points += 3;
    else if (own === other) points += 1;
  }

  return points * 1000 + goalDiff;
}

export interface QualificationSplit {
  directSemifinal: string[];
  playoff: string[];
  eliminated: string[];
  unresolvedTies: string[][];
}

export function splitQualification(standings: StandingRow[]): QualificationSplit {
  const unresolved: string[][] = [];
  const seen = new Set<string>();

  for (const row of standings) {
    if (row.tiedWith.length === 0 || seen.has(row.playerId)) continue;
    const group = [row.playerId, ...row.tiedWith].sort();
    group.forEach((id) => seen.add(id));
    unresolved.push(group);
  }

  return {
    directSemifinal: standings.filter((r) => r.zone === 'direct_semifinal').map((r) => r.playerId),
    playoff: standings.filter((r) => r.zone === 'playoff').map((r) => r.playerId),
    eliminated: standings.filter((r) => r.zone === 'eliminated').map((r) => r.playerId),
    unresolvedTies: unresolved,
  };
}
