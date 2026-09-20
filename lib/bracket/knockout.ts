import type { TournamentRules } from '@/lib/tournament/types';

export interface Leg {
  leg: 1 | 2;
  /** Home player of this leg. */
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
  extraTimeA?: number | null;
  extraTimeB?: number | null;
  penaltiesA?: number | null;
  penaltiesB?: number | null;
}

export interface TieInput {
  playerA: string;
  playerB: string;
  twoLegs: boolean;
  legs: Leg[];
  rules: Pick<TournamentRules, 'knockoutExtraTime' | 'knockoutPenalties' | 'awayGoalsRule'>;
}

export type TieOutcome =
  | { state: 'awaiting_legs'; aggregateA: number; aggregateB: number }
  | { state: 'needs_extra_time'; aggregateA: number; aggregateB: number }
  | { state: 'needs_penalties'; aggregateA: number; aggregateB: number }
  | {
      state: 'decided';
      winner: string;
      loser: string;
      aggregateA: number;
      aggregateB: number;
      decidedBy: 'aggregate' | 'away_goals' | 'extra_time' | 'penalties';
    }
  | { state: 'unresolvable'; aggregateA: number; aggregateB: number };

/**
 * Resolves a knockout tie from its verified legs.
 *
 * Rules implemented (§19, §20):
 *   - the tie winner is decided on aggregate across both legs;
 *   - a first leg never decides a tie, and never triggers extra time;
 *   - after the second leg a level aggregate goes to extra time, then penalties;
 *   - the away goals rule is off unless explicitly enabled.
 */
export function resolveTie(tie: TieInput): TieOutcome {
  const { playerA, playerB, twoLegs, legs, rules } = tie;

  const aggregate = aggregateScore(tie);
  const requiredLegs = twoLegs ? 2 : 1;
  const playedLegs = new Set(legs.map((l) => l.leg));

  if (playedLegs.size < requiredLegs) {
    return { state: 'awaiting_legs', aggregateA: aggregate.a, aggregateB: aggregate.b };
  }

  if (aggregate.a > aggregate.b) {
    return decided(playerA, playerB, aggregate, 'aggregate');
  }
  if (aggregate.b > aggregate.a) {
    return decided(playerB, playerA, aggregate, 'aggregate');
  }

  if (rules.awayGoalsRule && twoLegs) {
    const away = awayGoals(tie);
    if (away.a > away.b) return decided(playerA, playerB, aggregate, 'away_goals');
    if (away.b > away.a) return decided(playerB, playerA, aggregate, 'away_goals');
  }

  const decider = legs.find((l) => l.leg === requiredLegs);

  const pensA = decider?.penaltiesA ?? null;
  const pensB = decider?.penaltiesB ?? null;
  if (pensA !== null && pensB !== null && pensA !== pensB) {
    const aIsHome = decider!.playerA === playerA;
    const forA = aIsHome ? pensA : pensB;
    const forB = aIsHome ? pensB : pensA;
    return forA > forB
      ? decided(playerA, playerB, aggregate, 'penalties')
      : decided(playerB, playerA, aggregate, 'penalties');
  }

  const etA = decider?.extraTimeA ?? null;
  const etB = decider?.extraTimeB ?? null;
  if (etA !== null && etB !== null && etA !== etB) {
    const aIsHome = decider!.playerA === playerA;
    const forA = aIsHome ? etA : etB;
    const forB = aIsHome ? etB : etA;
    return forA > forB
      ? decided(playerA, playerB, aggregate, 'extra_time')
      : decided(playerB, playerA, aggregate, 'extra_time');
  }

  if (rules.knockoutExtraTime && etA === null) {
    return { state: 'needs_extra_time', aggregateA: aggregate.a, aggregateB: aggregate.b };
  }
  if (rules.knockoutPenalties) {
    return { state: 'needs_penalties', aggregateA: aggregate.a, aggregateB: aggregate.b };
  }

  return { state: 'unresolvable', aggregateA: aggregate.a, aggregateB: aggregate.b };
}

function decided(
  winner: string,
  loser: string,
  aggregate: { a: number; b: number },
  decidedBy: 'aggregate' | 'away_goals' | 'extra_time' | 'penalties',
): TieOutcome {
  return {
    state: 'decided',
    winner,
    loser,
    aggregateA: aggregate.a,
    aggregateB: aggregate.b,
    decidedBy,
  };
}

export function aggregateScore(tie: Pick<TieInput, 'playerA' | 'legs'>): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const leg of tie.legs) {
    if (leg.playerA === tie.playerA) {
      a += leg.scoreA;
      b += leg.scoreB;
    } else {
      a += leg.scoreB;
      b += leg.scoreA;
    }
  }
  return { a, b };
}

function awayGoals(tie: TieInput): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const leg of tie.legs) {
    // Goals scored by the visiting player in that leg.
    if (leg.playerA === tie.playerA) b += leg.scoreB;
    else a += leg.scoreB;
  }
  return { a, b };
}

/** Both legs of a tie, with the hosts reversed between them. */
export function tieLegFixtures(
  playerA: string,
  playerB: string,
  twoLegs: boolean,
): Array<{ leg: 1 | 2; playerA: string; playerB: string }> {
  const first = { leg: 1 as const, playerA, playerB };
  return twoLegs ? [first, { leg: 2 as const, playerA: playerB, playerB: playerA }] : [first];
}
