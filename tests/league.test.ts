import { describe, expect, it } from 'vitest';
import {
  expectedFixtureCount,
  expectedMatchesPerPlayer,
  generateDoubleRoundRobin,
  generateSingleRoundRobin,
} from '@/lib/league/scheduler';
import { buildStandings, splitQualification, zoneForPosition } from '@/lib/league/standings';
import type { LeagueResult, Tiebreaker } from '@/lib/tournament/types';

const EIGHT = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

const BASE_RULES = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  tiebreakers: ['points', 'goal_difference', 'goals_for', 'head_to_head'] as Tiebreaker[],
  directSemifinalSlots: 2,
  playoffSlots: 4,
};

describe('double round robin generation', () => {
  const fixtures = generateDoubleRoundRobin(EIGHT);

  it('produces 56 fixtures for 8 players', () => {
    expect(fixtures).toHaveLength(56);
    expect(fixtures).toHaveLength(expectedFixtureCount(8, true));
  });

  it('gives every player exactly 14 matches', () => {
    for (const player of EIGHT) {
      const count = fixtures.filter((f) => f.playerA === player || f.playerB === player).length;
      expect(count).toBe(14);
      expect(count).toBe(expectedMatchesPerPlayer(8, true));
    }
  });

  it('pairs every player with every other player exactly twice', () => {
    for (const a of EIGHT) {
      for (const b of EIGHT) {
        if (a === b) continue;
        const meetings = fixtures.filter(
          (f) => (f.playerA === a && f.playerB === b) || (f.playerA === b && f.playerB === a),
        );
        expect(meetings).toHaveLength(2);
      }
    }
  });

  it('creates exactly one first-leg and one reverse fixture per ordered pair', () => {
    const ordered = new Map<string, number>();
    for (const f of fixtures) {
      const key = `${f.playerA}>${f.playerB}`;
      ordered.set(key, (ordered.get(key) ?? 0) + 1);
    }
    // 8 * 7 = 56 ordered pairs, each appearing once.
    expect(ordered.size).toBe(56);
    for (const count of ordered.values()) expect(count).toBe(1);
  });

  it('never schedules a player twice in the same round', () => {
    const byRound = new Map<number, string[]>();
    for (const f of fixtures) {
      const list = byRound.get(f.roundNumber) ?? [];
      list.push(f.playerA, f.playerB);
      byRound.set(f.roundNumber, list);
    }
    expect(byRound.size).toBe(14);
    for (const players of byRound.values()) {
      expect(players).toHaveLength(8);
      expect(new Set(players).size).toBe(8);
    }
  });

  it('is deterministic — a refresh regenerates the identical schedule', () => {
    expect(generateDoubleRoundRobin(EIGHT)).toEqual(fixtures);
  });

  it('handles 16 players', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `q${i + 1}`);
    const schedule = generateDoubleRoundRobin(sixteen);
    expect(schedule).toHaveLength(240);
    for (const player of sixteen) {
      expect(
        schedule.filter((f) => f.playerA === player || f.playerB === player),
      ).toHaveLength(30);
    }
  });

  it('rejects invalid rosters', () => {
    expect(() => generateDoubleRoundRobin(['a', 'a', 'b', 'c'])).toThrow(
      'DUPLICATE_PLAYER_IN_SCHEDULE',
    );
    expect(() => generateDoubleRoundRobin(['a'])).toThrow('NOT_ENOUGH_PLAYERS');
    expect(() => generateDoubleRoundRobin(['a', 'b', 'c'])).toThrow(
      'ODD_PLAYER_COUNT_NOT_SUPPORTED',
    );
  });

  it('single round robin halves the fixture count', () => {
    expect(generateSingleRoundRobin(EIGHT)).toHaveLength(28);
  });
});

describe('standings', () => {
  it('awards points for wins, draws and losses', () => {
    const results: LeagueResult[] = [
      { playerA: 'p1', playerB: 'p2', scoreA: 3, scoreB: 1 },
      { playerA: 'p3', playerB: 'p4', scoreA: 2, scoreB: 2 },
    ];
    const table = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });

    const p1 = table.find((r) => r.playerId === 'p1')!;
    const p2 = table.find((r) => r.playerId === 'p2')!;
    const p3 = table.find((r) => r.playerId === 'p3')!;

    expect(p1.points).toBe(3);
    expect(p1.won).toBe(1);
    expect(p1.goalDifference).toBe(2);
    expect(p2.points).toBe(0);
    expect(p2.lost).toBe(1);
    expect(p3.points).toBe(1);
    expect(p3.drawn).toBe(1);
  });

  it('breaks ties by goal difference, then goals scored', () => {
    const results: LeagueResult[] = [
      // p1 and p2 both finish on 3 points; p1 has the better difference.
      { playerA: 'p1', playerB: 'p3', scoreA: 5, scoreB: 0 },
      { playerA: 'p2', playerB: 'p4', scoreA: 1, scoreB: 0 },
    ];
    const table = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });
    expect(table[0]!.playerId).toBe('p1');
    expect(table[1]!.playerId).toBe('p2');
  });

  it('prefers goals scored when points and difference are level', () => {
    const results: LeagueResult[] = [
      { playerA: 'p1', playerB: 'p3', scoreA: 4, scoreB: 2 },
      { playerA: 'p2', playerB: 'p4', scoreA: 2, scoreB: 0 },
    ];
    const table = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });
    expect(table[0]!.playerId).toBe('p1');
    expect(table[0]!.goalsFor).toBe(4);
  });

  it('uses head-to-head when points, difference and goals all match', () => {
    const results: LeagueResult[] = [
      // Identical records, but p2 beat p1 in their meeting.
      { playerA: 'p1', playerB: 'p3', scoreA: 3, scoreB: 0 },
      { playerA: 'p2', playerB: 'p4', scoreA: 3, scoreB: 0 },
      { playerA: 'p1', playerB: 'p2', scoreA: 0, scoreB: 1 },
      { playerA: 'p2', playerB: 'p1', scoreA: 0, scoreB: 1 },
      { playerA: 'p3', playerB: 'p1', scoreA: 1, scoreB: 0 },
      { playerA: 'p4', playerB: 'p2', scoreA: 1, scoreB: 0 },
    ];
    const table = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });

    const p1 = table.find((r) => r.playerId === 'p1')!;
    const p2 = table.find((r) => r.playerId === 'p2')!;
    expect(p1.points).toBe(p2.points);
    expect(p1.goalDifference).toBe(p2.goalDifference);
    expect(p1.goalsFor).toBe(p2.goalsFor);
    // Head to head is level too (one win each, same goals) — the pair is
    // reported as unresolved rather than silently ordered.
    expect(p1.tiedWith).toContain('p2');
  });

  it('respects a configured tie-break order', () => {
    // p1: 3 points, +3 difference, 3 scored. p2: 3 points, +1 difference, 4 scored.
    // Difference-first puts p1 top; goals-first puts p2 top.
    const results: LeagueResult[] = [
      { playerA: 'p1', playerB: 'p3', scoreA: 3, scoreB: 0 },
      { playerA: 'p2', playerB: 'p4', scoreA: 4, scoreB: 3 },
    ];

    const byDifference = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });
    expect(byDifference[0]!.playerId).toBe('p1');

    const byGoalsFirst = buildStandings({
      playerIds: EIGHT,
      results,
      rules: { ...BASE_RULES, tiebreakers: ['points', 'goals_for', 'goal_difference'] },
    });
    expect(byGoalsFirst[0]!.playerId).toBe('p2');
  });

  it('only counts the results it is given — pending matches cannot move the table', () => {
    const table = buildStandings({ playerIds: EIGHT, results: [], rules: BASE_RULES });
    expect(table).toHaveLength(8);
    for (const row of table) {
      expect(row.played).toBe(0);
      expect(row.points).toBe(0);
    }
  });

  it('keeps only the last five form entries', () => {
    const results: LeagueResult[] = Array.from({ length: 7 }, (_, i) => ({
      playerA: 'p1',
      playerB: EIGHT[(i % 6) + 2]!,
      scoreA: 1,
      scoreB: 0,
    }));
    const table = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });
    expect(table.find((r) => r.playerId === 'p1')!.form).toHaveLength(5);
  });
});

describe('qualification zones', () => {
  it('maps 1–2 to direct, 3–6 to playoff and 7–8 to elimination', () => {
    expect(zoneForPosition(1, 2, 4)).toBe('direct_semifinal');
    expect(zoneForPosition(2, 2, 4)).toBe('direct_semifinal');
    expect(zoneForPosition(3, 2, 4)).toBe('playoff');
    expect(zoneForPosition(6, 2, 4)).toBe('playoff');
    expect(zoneForPosition(7, 2, 4)).toBe('eliminated');
    expect(zoneForPosition(8, 2, 4)).toBe('eliminated');
  });

  it('reports no zones when the format has no knockout phase', () => {
    expect(zoneForPosition(1, 0, 0)).toBe('none');
  });

  it('splits a completed table into the three groups', () => {
    // Descending goal counts give a strict, unambiguous order.
    const results: LeagueResult[] = EIGHT.map((player, index) => ({
      playerA: player,
      playerB: EIGHT[(index + 1) % 8]!,
      scoreA: 8 - index,
      scoreB: 0,
    }));

    const table = buildStandings({ playerIds: EIGHT, results, rules: BASE_RULES });
    const split = splitQualification(table);

    expect(split.directSemifinal).toHaveLength(2);
    expect(split.playoff).toHaveLength(4);
    expect(split.eliminated).toHaveLength(2);
    expect(
      split.directSemifinal.length + split.playoff.length + split.eliminated.length,
    ).toBe(8);
  });
});
