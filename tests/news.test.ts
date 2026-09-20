import { describe, expect, it } from 'vitest';
import {
  classifyChampion,
  classifyDraw,
  classifyQualification,
  classifyVerifiedMatch,
  type VerifiedMatchFacts,
} from '@/lib/news/classify';
import { fallbackArticle } from '@/lib/ai/reporter';

function facts(scoreA: number, scoreB: number): VerifiedMatchFacts {
  return {
    matchId: 'match-1',
    tournamentName: 'بطولة الجمعة',
    stage: 'league',
    roundNumber: 6,
    playerA: { id: 'a', name: 'معتز عمر', team: 'Real Madrid' },
    playerB: { id: 'b', name: 'أحمد وعد', team: 'Barcelona' },
    scoreA,
    scoreB,
    verified: true,
  };
}

describe('deterministic event classification', () => {
  it('classifies a 6–1 as a big win', () => {
    const event = classifyVerifiedMatch(facts(6, 1), { bigWinGoalDiff: 4 });
    expect(event.eventType).toBe('BIG_WIN');
    expect(event.label).toBe('BIG_WIN');
    expect(event.facts.winner).toBe('معتز عمر');
    expect(event.facts.loser).toBe('أحمد وعد');
    expect(event.facts.score).toEqual({ winner: 6, loser: 1 });
  });

  it('does not call a narrow win a big win', () => {
    expect(classifyVerifiedMatch(facts(2, 1), { bigWinGoalDiff: 4 }).eventType).toBe(
      'MATCH_VERIFIED',
    );
    expect(classifyVerifiedMatch(facts(3, 0), { bigWinGoalDiff: 4 }).eventType).toBe(
      'MATCH_VERIFIED',
    );
  });

  it('respects a configured big-win threshold', () => {
    expect(classifyVerifiedMatch(facts(3, 0), { bigWinGoalDiff: 3 }).eventType).toBe('BIG_WIN');
  });

  it('classifies a high-scoring draw as dramatic', () => {
    const event = classifyVerifiedMatch(facts(3, 3), { bigWinGoalDiff: 4 });
    expect(event.eventType).toBe('DRAMATIC_DRAW');
    expect(event.facts.draw).toBe(true);
    expect(event.facts.winner).toBeNull();
  });

  it('treats a goalless draw as an ordinary report', () => {
    expect(classifyVerifiedMatch(facts(0, 0), { bigWinGoalDiff: 4 }).eventType).toBe(
      'MATCH_VERIFIED',
    );
  });

  it('always marks the facts as verified', () => {
    expect(classifyVerifiedMatch(facts(1, 0), { bigWinGoalDiff: 4 }).facts.verified).toBe(true);
  });

  it('derives a stable idempotency key per match and event', () => {
    const a = classifyVerifiedMatch(facts(6, 1), { bigWinGoalDiff: 4 });
    const b = classifyVerifiedMatch(facts(6, 1), { bigWinGoalDiff: 4 });
    expect(a.eventKey).toBe(b.eventKey);
    expect(a.eventKey).toBe('match:match-1:BIG_WIN');

    const different = classifyVerifiedMatch(facts(2, 1), { bigWinGoalDiff: 4 });
    expect(different.eventKey).not.toBe(a.eventKey);
  });

  it('keys tournament-level events once per tournament', () => {
    expect(classifyChampion('t1', 'بطولة', 'معتز', null).eventKey).toBe('tournament:t1:CHAMPION');
    expect(classifyDraw('t1', 'بطولة', 'playoff', []).eventKey).toBe('tournament:t1:PLAYOFF_DRAW');
    expect(classifyQualification('t1', 'بطولة', [], [], []).eventKey).toBe(
      'tournament:t1:QUALIFIED',
    );
  });
});

describe('reporter fallback copy', () => {
  it('never invents a scoreline', () => {
    const event = classifyVerifiedMatch(facts(6, 1), { bigWinGoalDiff: 4 });
    const article = fallbackArticle(event);
    expect(article.body).toContain('6');
    expect(article.body).toContain('1');
    expect(article.body).toContain('معتز عمر');
  });

  it('only says اكتساح for a classified big win', () => {
    const narrow = fallbackArticle(classifyVerifiedMatch(facts(2, 1), { bigWinGoalDiff: 4 }));
    expect(`${narrow.headline} ${narrow.body}`).not.toContain('اكتساح');
  });

  it('writes champion copy from the champion event', () => {
    const article = fallbackArticle(classifyChampion('t1', 'بطولة الجمعة', 'معتز عمر', null));
    expect(article.headline).toContain('معتز عمر');
    expect(article.body).toContain('بطولة الجمعة');
  });
});
