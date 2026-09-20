import { describe, expect, it } from 'vitest';
import { aggregateScore, resolveTie, tieLegFixtures, type Leg } from '@/lib/bracket/knockout';
import { openDraw, seededSemifinalDraw, secureShuffle, hashOrder } from '@/lib/bracket/draw';

const RULES = { knockoutExtraTime: true, knockoutPenalties: true, awayGoalsRule: false };

function tie(legs: Leg[], overrides: Partial<Parameters<typeof resolveTie>[0]> = {}) {
  return resolveTie({
    playerA: 'ahmed',
    playerB: 'mutaz',
    twoLegs: true,
    legs,
    rules: RULES,
    ...overrides,
  });
}

describe('knockout ties', () => {
  it('generates a first leg and a reversed second leg', () => {
    expect(tieLegFixtures('ahmed', 'mutaz', true)).toEqual([
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz' },
      { leg: 2, playerA: 'mutaz', playerB: 'ahmed' },
    ]);
  });

  it('a single-leg tie has one fixture', () => {
    expect(tieLegFixtures('ahmed', 'mutaz', false)).toHaveLength(1);
  });

  it('does not decide a tie after the first leg', () => {
    const outcome = tie([{ leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 3, scoreB: 0 }]);
    expect(outcome.state).toBe('awaiting_legs');
  });

  it('decides on aggregate after the second leg', () => {
    // §19 worked example: Ahmed 2–1 Mutaz, then Mutaz 3–1 Ahmed → Mutaz 4–3.
    const outcome = tie([
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 2, scoreB: 1 },
      { leg: 2, playerA: 'mutaz', playerB: 'ahmed', scoreA: 3, scoreB: 1 },
    ]);

    expect(outcome.state).toBe('decided');
    if (outcome.state !== 'decided') return;
    expect(outcome.winner).toBe('mutaz');
    expect(outcome.aggregateA).toBe(3);
    expect(outcome.aggregateB).toBe(4);
    expect(outcome.decidedBy).toBe('aggregate');
  });

  it('computes aggregate irrespective of which side hosted', () => {
    const agg = aggregateScore({
      playerA: 'ahmed',
      legs: [
        { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 2, scoreB: 1 },
        { leg: 2, playerA: 'mutaz', playerB: 'ahmed', scoreA: 3, scoreB: 1 },
      ],
    });
    expect(agg).toEqual({ a: 3, b: 4 });
  });

  it('asks for extra time when the aggregate is level', () => {
    const outcome = tie([
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 1, scoreB: 1 },
      { leg: 2, playerA: 'mutaz', playerB: 'ahmed', scoreA: 2, scoreB: 2 },
    ]);
    expect(outcome.state).toBe('needs_extra_time');
  });

  it('resolves on extra time when it separates the players', () => {
    const outcome = tie([
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 1, scoreB: 1 },
      {
        leg: 2,
        playerA: 'mutaz',
        playerB: 'ahmed',
        scoreA: 2,
        scoreB: 2,
        extraTimeA: 1,
        extraTimeB: 0,
      },
    ]);
    expect(outcome.state).toBe('decided');
    if (outcome.state !== 'decided') return;
    expect(outcome.winner).toBe('mutaz');
    expect(outcome.decidedBy).toBe('extra_time');
  });

  it('asks for penalties when extra time is also level', () => {
    const outcome = tie([
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 1, scoreB: 1 },
      {
        leg: 2,
        playerA: 'mutaz',
        playerB: 'ahmed',
        scoreA: 2,
        scoreB: 2,
        extraTimeA: 1,
        extraTimeB: 1,
      },
    ]);
    expect(outcome.state).toBe('needs_penalties');
  });

  it('resolves on penalties, mapping the shootout to the right players', () => {
    const outcome = tie([
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 1, scoreB: 1 },
      {
        leg: 2,
        playerA: 'mutaz',
        playerB: 'ahmed',
        scoreA: 2,
        scoreB: 2,
        extraTimeA: 1,
        extraTimeB: 1,
        penaltiesA: 3,
        penaltiesB: 5,
      },
    ]);
    expect(outcome.state).toBe('decided');
    if (outcome.state !== 'decided') return;
    // The second leg is hosted by Mutaz, so penaltiesB belongs to Ahmed.
    expect(outcome.winner).toBe('ahmed');
    expect(outcome.decidedBy).toBe('penalties');
  });

  it('ignores away goals unless the rule is enabled', () => {
    // Aggregate 2–2. Ahmed scored 1 away (second leg), Mutaz scored 0 away.
    const legs: Leg[] = [
      { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 1, scoreB: 0 },
      { leg: 2, playerA: 'mutaz', playerB: 'ahmed', scoreA: 2, scoreB: 1 },
    ];

    expect(tie(legs).state).toBe('needs_extra_time');

    const withAwayGoals = resolveTie({
      playerA: 'ahmed',
      playerB: 'mutaz',
      twoLegs: true,
      legs,
      rules: { ...RULES, awayGoalsRule: true },
    });
    expect(withAwayGoals.state).toBe('decided');
    if (withAwayGoals.state !== 'decided') return;
    expect(withAwayGoals.decidedBy).toBe('away_goals');
    expect(withAwayGoals.winner).toBe('ahmed');
  });

  it('reports unresolvable when both deciders are disabled', () => {
    const outcome = resolveTie({
      playerA: 'ahmed',
      playerB: 'mutaz',
      twoLegs: true,
      legs: [
        { leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 0, scoreB: 0 },
        { leg: 2, playerA: 'mutaz', playerB: 'ahmed', scoreA: 0, scoreB: 0 },
      ],
      rules: { knockoutExtraTime: false, knockoutPenalties: false, awayGoalsRule: false },
    });
    expect(outcome.state).toBe('unresolvable');
  });

  it('decides a single-leg tie immediately', () => {
    const outcome = tie([{ leg: 1, playerA: 'ahmed', playerB: 'mutaz', scoreA: 2, scoreB: 0 }], {
      twoLegs: false,
    });
    expect(outcome.state).toBe('decided');
    if (outcome.state !== 'decided') return;
    expect(outcome.winner).toBe('ahmed');
  });
});

describe('official draw', () => {
  // Deterministic source so the assertions describe behaviour, not luck.
  const fixed = (max: number) => max - 1;

  it('pairs an even pot into ties', () => {
    const result = openDraw(['a', 'b', 'c', 'd'], fixed);
    expect(result.pairings).toHaveLength(2);
    expect(result.order).toHaveLength(4);
    expect(new Set(result.order).size).toBe(4);
  });

  it('rejects an odd or duplicated pot', () => {
    expect(() => openDraw(['a', 'b', 'c'])).toThrow('DRAW_REQUIRES_EVEN_NON_EMPTY_POT');
    expect(() => openDraw([])).toThrow('DRAW_REQUIRES_EVEN_NON_EMPTY_POT');
    expect(() => openDraw(['a', 'a'])).toThrow('DRAW_POT_HAS_DUPLICATES');
  });

  it('keeps the two seeds apart in a seeded semifinal draw', () => {
    for (const random of [fixed, () => 0]) {
      const result = seededSemifinalDraw(['first', 'second'], ['w1', 'w2'], random);
      expect(result.pairings).toHaveLength(2);
      for (const pair of result.pairings) {
        const sides = [pair.playerA, pair.playerB];
        expect(sides.filter((s) => s === 'first' || s === 'second')).toHaveLength(1);
      }
    }
  });

  it('rejects a seeded draw with the wrong pot sizes', () => {
    expect(() => seededSemifinalDraw(['a'], ['b', 'c'])).toThrow(
      'SEEDED_DRAW_REQUIRES_TWO_SEEDS_AND_TWO_QUALIFIERS',
    );
  });

  it('shuffling preserves the multiset of entrants', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    const shuffled = secureShuffle(input);
    expect([...shuffled].sort()).toEqual([...input].sort());
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('commits a stable fingerprint of the drawn order', () => {
    expect(hashOrder(['a', 'b'])).toBe(hashOrder(['a', 'b']));
    expect(hashOrder(['a', 'b'])).not.toBe(hashOrder(['b', 'a']));
  });
});
