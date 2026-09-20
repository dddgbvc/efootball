import type { Fixture } from '@/lib/tournament/types';

/**
 * Double round robin schedule via the circle method.
 *
 * For n players (n even) the first leg has n-1 rounds of n/2 fixtures. The
 * second leg repeats every round with home and away reversed, so each ordered
 * pair (a plays b at "home") occurs exactly once across the whole schedule.
 *
 * 8 players  -> 14 rounds, 56 matches, 14 matches per player.
 * 16 players -> 30 rounds, 240 matches, 30 matches per player.
 *
 * The result is deterministic for a given player order, which is what makes the
 * schedule safe to persist once and never regenerate.
 */
export function generateDoubleRoundRobin(playerIds: string[]): Fixture[] {
  return generateRoundRobin(playerIds, true);
}

export function generateSingleRoundRobin(playerIds: string[]): Fixture[] {
  return generateRoundRobin(playerIds, false);
}

function generateRoundRobin(playerIds: string[], doubleRound: boolean): Fixture[] {
  const unique = new Set(playerIds);
  if (unique.size !== playerIds.length) {
    throw new Error('DUPLICATE_PLAYER_IN_SCHEDULE');
  }
  if (playerIds.length < 2) {
    throw new Error('NOT_ENOUGH_PLAYERS');
  }
  if (playerIds.length % 2 !== 0) {
    throw new Error('ODD_PLAYER_COUNT_NOT_SUPPORTED');
  }

  const n = playerIds.length;
  const rotation = [...playerIds];
  const roundsPerLeg = n - 1;
  const fixtures: Fixture[] = [];

  for (let round = 0; round < roundsPerLeg; round += 1) {
    for (let i = 0; i < n / 2; i += 1) {
      const home = rotation[i]!;
      const away = rotation[n - 1 - i]!;

      // Alternate the host each round so nobody hosts every first leg.
      const swap = round % 2 === 1 && i === 0;
      const first: Fixture = {
        roundNumber: round + 1,
        leg: 1,
        playerA: swap ? away : home,
        playerB: swap ? home : away,
      };
      fixtures.push(first);

      if (doubleRound) {
        fixtures.push({
          roundNumber: roundsPerLeg + round + 1,
          leg: 2,
          playerA: first.playerB,
          playerB: first.playerA,
        });
      }
    }

    // Rotate every position except the first.
    const fixed = rotation[0]!;
    const rest = rotation.slice(1);
    const last = rest.pop()!;
    rotation.splice(0, rotation.length, fixed, last, ...rest);
  }

  return fixtures.sort((a, b) => a.roundNumber - b.roundNumber);
}

export function expectedFixtureCount(playerCount: number, doubleRound: boolean): number {
  const single = (playerCount * (playerCount - 1)) / 2;
  return doubleRound ? single * 2 : single;
}

export function expectedMatchesPerPlayer(playerCount: number, doubleRound: boolean): number {
  return doubleRound ? (playerCount - 1) * 2 : playerCount - 1;
}

export function groupFixturesByRound(fixtures: Fixture[]): Map<number, Fixture[]> {
  const rounds = new Map<number, Fixture[]>();
  for (const fixture of fixtures) {
    const bucket = rounds.get(fixture.roundNumber);
    if (bucket) bucket.push(fixture);
    else rounds.set(fixture.roundNumber, [fixture]);
  }
  return rounds;
}
