import type { StatisticPair, VisionExtraction } from './schema';

export type VerificationReason =
  | 'score_mismatch'
  | 'identity_mismatch'
  | 'team_mismatch'
  | 'statistics_mismatch'
  | 'low_confidence'
  | 'invalid_result_screen'
  | 'unreadable_evidence';

export interface CrossVerifyOptions {
  minConfidence: number;
  /** Relative tolerance when comparing the same statistic across both screenshots. */
  statisticTolerance: number;
  /** Expected participants, used to catch screenshots from a different match. */
  expectedNames?: { playerA: string[]; playerB: string[] };
}

export interface CrossVerifyResult {
  outcome: 'verified' | 'review_required';
  reasons: VerificationReason[];
  agreedScore: { playerA: number; playerB: number } | null;
  detail: {
    scoreA: [number, number];
    scoreB: [number, number];
    identityMatched: boolean;
    teamsMatched: boolean;
    statisticsCompared: number;
    statisticsDisagreed: string[];
    lowestConfidence: number;
  };
}

/**
 * Dual-screenshot cross verification (§34).
 *
 * A matching numeric score is necessary but never sufficient: identities, teams,
 * logo detection, the statistics block and every confidence band must also line
 * up before a result is allowed to become official.
 */
export function crossVerify(
  a: VisionExtraction,
  b: VisionExtraction,
  options: CrossVerifyOptions,
): CrossVerifyResult {
  const reasons = new Set<VerificationReason>();

  if (!a.validResultScreen || !b.validResultScreen) {
    reasons.add('invalid_result_screen');
  }

  // Orient B onto A's axis. The two players photograph the same screen but the
  // sides can be labelled in either order.
  const oriented = orient(a, b);

  const scoreMatches =
    a.score.playerA === oriented.score.playerA && a.score.playerB === oriented.score.playerB;
  if (!scoreMatches) reasons.add('score_mismatch');

  const identityMatched = namesAgree(a, oriented, options.expectedNames);
  if (!identityMatched) reasons.add('identity_mismatch');

  const teamsMatched = teamsAgree(a, oriented);
  if (!teamsMatched) reasons.add('team_mismatch');

  const stats = compareStatistics(a.statistics, oriented.statistics, options.statisticTolerance);
  if (stats.disagreed.length > 0) reasons.add('statistics_mismatch');

  const lowestConfidence = Math.min(
    a.confidence.overall,
    a.confidence.score,
    a.confidence.identity,
    b.confidence.overall,
    b.confidence.score,
    b.confidence.identity,
  );
  if (lowestConfidence < options.minConfidence) reasons.add('low_confidence');

  const unreadable =
    (a.playerA.name === null && a.playerB.name === null) ||
    (b.playerA.name === null && b.playerB.name === null);
  if (unreadable) reasons.add('unreadable_evidence');

  const outcome = reasons.size === 0 ? 'verified' : 'review_required';

  return {
    outcome,
    reasons: [...reasons],
    agreedScore: outcome === 'verified' ? { ...a.score } : null,
    detail: {
      scoreA: [a.score.playerA, oriented.score.playerA],
      scoreB: [a.score.playerB, oriented.score.playerB],
      identityMatched,
      teamsMatched,
      statisticsCompared: stats.compared,
      statisticsDisagreed: stats.disagreed,
      lowestConfidence,
    },
  };
}

/**
 * Returns `b` expressed on `a`'s player axis, flipping the sides when the
 * second screenshot lists the same two players the other way round.
 */
export function orient(a: VisionExtraction, b: VisionExtraction): VisionExtraction {
  const direct = similarity(a.playerA, b.playerA) + similarity(a.playerB, b.playerB);
  const flipped = similarity(a.playerA, b.playerB) + similarity(a.playerB, b.playerA);

  if (flipped <= direct) return b;

  return {
    ...b,
    playerA: b.playerB,
    playerB: b.playerA,
    score: { playerA: b.score.playerB, playerB: b.score.playerA },
    penalties: b.penalties
      ? { playerA: b.penalties.playerB, playerB: b.penalties.playerA }
      : b.penalties,
    statistics: Object.fromEntries(
      Object.entries(b.statistics).map(([key, value]) => [
        key,
        { ...value, playerA: value.playerB, playerB: value.playerA },
      ]),
    ),
  };
}

function similarity(
  x: { name: string | null; team: string | null },
  y: { name: string | null; team: string | null },
): number {
  let score = 0;
  if (x.name && y.name && normalize(x.name) === normalize(y.name)) score += 2;
  if (x.team && y.team && normalize(x.team) === normalize(y.team)) score += 1;
  return score;
}

function namesAgree(
  a: VisionExtraction,
  b: VisionExtraction,
  expected?: CrossVerifyOptions['expectedNames'],
): boolean {
  const pairsAgree =
    softEqual(a.playerA.name, b.playerA.name) && softEqual(a.playerB.name, b.playerB.name);
  if (!pairsAgree) return false;

  if (!expected) return true;

  const matchesExpected =
    anyMatches(a.playerA.name, expected.playerA) && anyMatches(a.playerB.name, expected.playerB);
  const matchesSwapped =
    anyMatches(a.playerA.name, expected.playerB) && anyMatches(a.playerB.name, expected.playerA);

  return matchesExpected || matchesSwapped;
}

function teamsAgree(a: VisionExtraction, b: VisionExtraction): boolean {
  if (!softEqual(a.playerA.team, b.playerA.team)) return false;
  if (!softEqual(a.playerB.team, b.playerB.team)) return false;

  // If both screenshots claim to have seen a crest, they must have seen the
  // same one — this is what catches two screenshots from different matches
  // that happen to share a scoreline.
  if (a.playerA.logoDetected && b.playerA.logoDetected && !softEqual(a.playerA.team, b.playerA.team))
    return false;
  if (a.playerB.logoDetected && b.playerB.logoDetected && !softEqual(a.playerB.team, b.playerB.team))
    return false;

  return true;
}

function anyMatches(value: string | null, candidates: string[]): boolean {
  if (!value) return false;
  const v = normalize(value);
  return candidates.some((c) => {
    const n = normalize(c);
    return n.length > 0 && (n === v || n.includes(v) || v.includes(n));
  });
}

function softEqual(x: string | null | undefined, y: string | null | undefined): boolean {
  // A field neither screenshot could read is not evidence of disagreement.
  if (!x || !y) return true;
  return normalize(x) === normalize(y);
}

/** Case, diacritic and separator insensitive; works for Arabic and Latin names. */
export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[ً-ٰٟ̀-ͯ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
    .trim();
}

function compareStatistics(
  a: Record<string, StatisticPair>,
  b: Record<string, StatisticPair>,
  tolerance: number,
): { compared: number; disagreed: string[] } {
  const keys = Object.keys(a).filter((k) => k in b);
  const disagreed: string[] = [];

  for (const key of keys) {
    const left = a[key]!;
    const right = b[key]!;
    if (!withinTolerance(left.playerA, right.playerA, tolerance)) disagreed.push(key);
    else if (!withinTolerance(left.playerB, right.playerB, tolerance)) disagreed.push(key);
  }

  return { compared: keys.length, disagreed };
}

function withinTolerance(x: number, y: number, tolerance: number): boolean {
  if (x === y) return true;
  const scale = Math.max(Math.abs(x), Math.abs(y), 1);
  return Math.abs(x - y) / scale <= tolerance;
}
