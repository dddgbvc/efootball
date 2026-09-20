import { createHash, randomInt } from 'node:crypto';
import type { TiePairing } from '@/lib/tournament/types';

export type RandomSource = (maxExclusive: number) => number;

/** Cryptographically strong by default; tests inject a deterministic source. */
export const cryptoRandom: RandomSource = (maxExclusive) => randomInt(maxExclusive);

/**
 * Fisher–Yates over a CSPRNG. This runs on the server only: the client is never
 * given the entropy, the ordering, or a chance to influence the outcome — it
 * only reveals the persisted result.
 */
export function secureShuffle<T>(items: readonly T[], random: RandomSource = cryptoRandom): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export interface DrawResult {
  pairings: TiePairing[];
  order: string[];
  seedHash: string;
}

/**
 * Open draw: every entrant goes into the pot and is paired in shuffled order.
 * Used for the playoff draw (§17) and for the open-draw semifinal mode (§18B).
 */
export function openDraw(playerIds: string[], random: RandomSource = cryptoRandom): DrawResult {
  assertDrawable(playerIds);
  const order = secureShuffle(playerIds, random);
  return {
    order,
    pairings: pairSequentially(order),
    seedHash: hashOrder(order),
  };
}

/**
 * Seeded semifinal draw (§18A): the two direct qualifiers are kept apart, each
 * facing one of the playoff winners. Which playoff winner meets which seed is
 * still randomised.
 */
export function seededSemifinalDraw(
  seeds: string[],
  qualifiers: string[],
  random: RandomSource = cryptoRandom,
): DrawResult {
  if (seeds.length !== 2 || qualifiers.length !== 2) {
    throw new Error('SEEDED_DRAW_REQUIRES_TWO_SEEDS_AND_TWO_QUALIFIERS');
  }
  assertDrawable([...seeds, ...qualifiers]);

  const shuffledQualifiers = secureShuffle(qualifiers, random);
  const pairings: TiePairing[] = [
    { position: 1, playerA: seeds[0]!, playerB: shuffledQualifiers[0]! },
    { position: 2, playerA: seeds[1]!, playerB: shuffledQualifiers[1]! },
  ];

  const order = pairings.flatMap((p) => [p.playerA, p.playerB]);
  return { pairings, order, seedHash: hashOrder(order) };
}

function pairSequentially(order: string[]): TiePairing[] {
  const pairings: TiePairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    pairings.push({
      position: pairings.length + 1,
      playerA: order[i]!,
      playerB: order[i + 1]!,
    });
  }
  return pairings;
}

function assertDrawable(playerIds: string[]): void {
  if (playerIds.length === 0 || playerIds.length % 2 !== 0) {
    throw new Error('DRAW_REQUIRES_EVEN_NON_EMPTY_POT');
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('DRAW_POT_HAS_DUPLICATES');
  }
}

/**
 * A fingerprint of the drawn order, stored alongside the draw. It lets anyone
 * confirm afterwards that the revealed pairings are the ones that were
 * committed at draw time.
 */
export function hashOrder(order: string[]): string {
  return createHash('sha256').update(order.join('|')).digest('hex');
}
