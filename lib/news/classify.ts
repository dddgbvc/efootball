import type { MatchStage } from '@/lib/tournament/types';

export type OfficialEventType =
  | 'MATCH_VERIFIED'
  | 'BIG_WIN'
  | 'DRAMATIC_DRAW'
  | 'QUALIFIED'
  | 'ELIMINATED'
  | 'PLAYOFF_DRAW'
  | 'SEMIFINAL_PAIRING'
  | 'FINAL_PAIRING'
  | 'CHAMPION'
  | 'STANDINGS_SHIFT';

export const EVENT_LABEL: Record<OfficialEventType, string> = {
  MATCH_VERIFIED: 'MATCH_REPORT',
  BIG_WIN: 'BIG_WIN',
  DRAMATIC_DRAW: 'DRAW',
  QUALIFIED: 'QUALIFIED',
  ELIMINATED: 'BREAKING',
  PLAYOFF_DRAW: 'PLAYOFF',
  SEMIFINAL_PAIRING: 'PLAYOFF',
  FINAL_PAIRING: 'FINAL',
  CHAMPION: 'CHAMPION',
  STANDINGS_SHIFT: 'STANDINGS',
};

export interface VerifiedMatchFacts {
  matchId: string;
  tournamentName: string;
  stage: MatchStage;
  roundNumber: number | null;
  playerA: { id: string; name: string; team: string | null };
  playerB: { id: string; name: string; team: string | null };
  scoreA: number;
  scoreB: number;
  aggregateA?: number | null;
  aggregateB?: number | null;
  leg?: 1 | 2 | null;
  decidedBy?: 'aggregate' | 'away_goals' | 'extra_time' | 'penalties' | null;
  statistics?: Record<string, { playerA: number; playerB: number }>;
  /** Positions before and after this result, when the league table moved. */
  standingsDelta?: Array<{ playerId: string; from: number; to: number }>;
  verified: true;
}

export interface ClassifiedEvent {
  eventType: OfficialEventType;
  label: string;
  /** Stable key so the whole reaction pipeline is idempotent. */
  eventKey: string;
  facts: Record<string, unknown>;
}

export interface ClassifyOptions {
  bigWinGoalDiff: number;
}

/**
 * Deterministic event classification (§48).
 *
 * The classifier — not the language model — decides whether a result is an
 * اكتساح, a dramatic draw or an ordinary match report. The model only receives
 * the label and the verified numbers, so it can never promote a 2–1 into a rout.
 */
export function classifyVerifiedMatch(
  facts: VerifiedMatchFacts,
  options: ClassifyOptions,
): ClassifiedEvent {
  const diff = Math.abs(facts.scoreA - facts.scoreB);
  const totalGoals = facts.scoreA + facts.scoreB;
  const isDraw = facts.scoreA === facts.scoreB;

  let eventType: OfficialEventType = 'MATCH_VERIFIED';

  if (!isDraw && diff >= options.bigWinGoalDiff) {
    eventType = 'BIG_WIN';
  } else if (isDraw && totalGoals >= 4) {
    eventType = 'DRAMATIC_DRAW';
  }

  const winner =
    facts.scoreA > facts.scoreB
      ? facts.playerA
      : facts.scoreB > facts.scoreA
        ? facts.playerB
        : null;
  const loser = winner === null ? null : winner === facts.playerA ? facts.playerB : facts.playerA;

  return {
    eventType,
    label: EVENT_LABEL[eventType],
    eventKey: `match:${facts.matchId}:${eventType}`,
    facts: {
      eventType,
      tournament: facts.tournamentName,
      stage: facts.stage,
      round: facts.roundNumber,
      leg: facts.leg ?? null,
      winner: winner?.name ?? null,
      loser: loser?.name ?? null,
      draw: isDraw,
      score: winner
        ? {
            winner: Math.max(facts.scoreA, facts.scoreB),
            loser: Math.min(facts.scoreA, facts.scoreB),
          }
        : { playerA: facts.scoreA, playerB: facts.scoreB },
      players: {
        playerA: { name: facts.playerA.name, team: facts.playerA.team },
        playerB: { name: facts.playerB.name, team: facts.playerB.team },
      },
      goalDifference: diff,
      aggregate:
        facts.aggregateA !== null && facts.aggregateA !== undefined
          ? { playerA: facts.aggregateA, playerB: facts.aggregateB ?? 0 }
          : null,
      decidedBy: facts.decidedBy ?? null,
      statistics: facts.statistics ?? null,
      standingsDelta: facts.standingsDelta ?? null,
      verified: true,
    },
  };
}

export function classifyChampion(
  tournamentId: string,
  tournamentName: string,
  championName: string,
  runnerUpName: string | null,
): ClassifiedEvent {
  return {
    eventType: 'CHAMPION',
    label: EVENT_LABEL.CHAMPION,
    eventKey: `tournament:${tournamentId}:CHAMPION`,
    facts: {
      eventType: 'CHAMPION',
      tournament: tournamentName,
      champion: championName,
      runnerUp: runnerUpName,
      verified: true,
    },
  };
}

export function classifyDraw(
  tournamentId: string,
  tournamentName: string,
  kind: 'playoff' | 'semifinal' | 'final',
  pairings: Array<{ playerA: string; playerB: string }>,
): ClassifiedEvent {
  const eventType: OfficialEventType =
    kind === 'playoff'
      ? 'PLAYOFF_DRAW'
      : kind === 'semifinal'
        ? 'SEMIFINAL_PAIRING'
        : 'FINAL_PAIRING';

  return {
    eventType,
    label: EVENT_LABEL[eventType],
    eventKey: `tournament:${tournamentId}:${eventType}`,
    facts: {
      eventType,
      tournament: tournamentName,
      pairings,
      verified: true,
    },
  };
}

export function classifyQualification(
  tournamentId: string,
  tournamentName: string,
  direct: string[],
  playoff: string[],
  eliminated: string[],
): ClassifiedEvent {
  return {
    eventType: 'QUALIFIED',
    label: EVENT_LABEL.QUALIFIED,
    eventKey: `tournament:${tournamentId}:QUALIFIED`,
    facts: {
      eventType: 'QUALIFIED',
      tournament: tournamentName,
      directToSemifinal: direct,
      toPlayoffs: playoff,
      eliminated,
      verified: true,
    },
  };
}
