import { describe, expect, it } from 'vitest';
import { crossVerify, normalize, orient } from '@/lib/ai/crossVerify';
import { safeParseExtraction } from '@/lib/ai/schema';
import { fromWire } from '@/lib/ai/vision';
import type { VisionExtraction } from '@/lib/ai/schema';

const OPTIONS = { minConfidence: 0.85, statisticTolerance: 0.15 };

function extraction(overrides: Partial<VisionExtraction> = {}): VisionExtraction {
  return {
    validResultScreen: true,
    game: 'eFootball',
    playerA: { name: 'Mutaz Omar', team: 'Real Madrid', logoDetected: true },
    playerB: { name: 'Ahmed Waad', team: 'Barcelona', logoDetected: true },
    score: { playerA: 3, playerB: 1 },
    statistics: {
      possession: { playerA: 54, playerB: 46 },
      shots: { playerA: 11, playerB: 7 },
    },
    confidence: { overall: 0.97, score: 0.99, identity: 0.94, statistics: 0.95 },
    ...overrides,
  };
}

describe('AI output validation', () => {
  it('accepts a well-formed extraction', () => {
    const parsed = safeParseExtraction(extraction());
    expect(parsed.ok).toBe(true);
  });

  it('rejects output missing the score', () => {
    const bad = { ...extraction(), score: undefined };
    const parsed = safeParseExtraction(bad);
    expect(parsed.ok).toBe(false);
  });

  it('rejects out-of-range confidence', () => {
    const parsed = safeParseExtraction(
      extraction({ confidence: { overall: 1.4, score: 1, identity: 1, statistics: 1 } }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects negative and non-integer scores', () => {
    expect(safeParseExtraction(extraction({ score: { playerA: -1, playerB: 0 } })).ok).toBe(false);
    expect(safeParseExtraction(extraction({ score: { playerA: 1.5, playerB: 0 } })).ok).toBe(false);
  });

  it('folds the wire statistic list into an open record', () => {
    const normalized = fromWire({
      validResultScreen: true,
      game: 'eFootball',
      screenType: 'result',
      playerA: { name: 'A', team: 'X', logoDetected: true, logoDescription: null },
      playerB: { name: 'B', team: 'Y', logoDetected: true, logoDescription: null },
      scoreA: 2,
      scoreB: 1,
      penaltiesA: null,
      penaltiesB: null,
      statistics: [
        { key: 'Shots On Target', labelAr: null, playerA: 5, playerB: 2, unit: null },
        { key: 'possession', labelAr: null, playerA: 60, playerB: 40, unit: '%' },
      ],
      confidenceOverall: 0.9,
      confidenceScore: 0.95,
      confidenceIdentity: 0.9,
      confidenceStatistics: 0.9,
      notes: null,
    });

    const parsed = safeParseExtraction(normalized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // An unanticipated metric survives without any schema change.
    expect(parsed.data.statistics.shots_on_target).toEqual({ playerA: 5, playerB: 2 });
    expect(parsed.data.statistics.possession?.unit).toBe('%');
  });

  it('clamps confidence values that arrive out of range', () => {
    const normalized = fromWire({
      validResultScreen: true,
      game: 'eFootball',
      screenType: null,
      playerA: { name: 'A', team: null, logoDetected: false, logoDescription: null },
      playerB: { name: 'B', team: null, logoDetected: false, logoDescription: null },
      scoreA: 0,
      scoreB: 0,
      penaltiesA: null,
      penaltiesB: null,
      statistics: [],
      confidenceOverall: 5,
      confidenceScore: -2,
      confidenceIdentity: Number.NaN,
      confidenceStatistics: 0.5,
      notes: null,
    }) as { confidence: Record<string, number> };

    expect(normalized.confidence.overall).toBe(1);
    expect(normalized.confidence.score).toBe(0);
    expect(normalized.confidence.identity).toBe(0);
  });
});

describe('dual screenshot cross verification', () => {
  it('verifies two agreeing screenshots', () => {
    const verdict = crossVerify(extraction(), extraction(), OPTIONS);
    expect(verdict.outcome).toBe('verified');
    expect(verdict.reasons).toEqual([]);
    expect(verdict.agreedScore).toEqual({ playerA: 3, playerB: 1 });
  });

  it('flags a score mismatch', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({ score: { playerA: 2, playerB: 1 } }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('score_mismatch');
    expect(verdict.agreedScore).toBeNull();
  });

  it('flags an identity mismatch even when the score agrees', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({ playerB: { name: 'Khalid', team: 'Barcelona', logoDetected: true } }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('identity_mismatch');
  });

  it('flags a team mismatch even when the score agrees', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({ playerA: { name: 'Mutaz Omar', team: 'Juventus', logoDetected: true } }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('team_mismatch');
  });

  it('flags statistics that disagree beyond the tolerance', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({
        statistics: {
          possession: { playerA: 54, playerB: 46 },
          shots: { playerA: 22, playerB: 7 },
        },
      }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('statistics_mismatch');
    expect(verdict.detail.statisticsDisagreed).toContain('shots');
  });

  it('tolerates small statistical noise', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({
        statistics: {
          possession: { playerA: 55, playerB: 45 },
          shots: { playerA: 11, playerB: 7 },
        },
      }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('verified');
  });

  it('flags low confidence', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({ confidence: { overall: 0.4, score: 0.4, identity: 0.4, statistics: 0.4 } }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('low_confidence');
  });

  it('flags an invalid result screen', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({ validResultScreen: false }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('invalid_result_screen');
  });

  it('flags unreadable evidence', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({
        playerA: { name: null, team: null, logoDetected: false },
        playerB: { name: null, team: null, logoDetected: false },
      }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('unreadable_evidence');
  });

  it('orients a mirrored screenshot before comparing', () => {
    const flipped = extraction({
      playerA: { name: 'Ahmed Waad', team: 'Barcelona', logoDetected: true },
      playerB: { name: 'Mutaz Omar', team: 'Real Madrid', logoDetected: true },
      score: { playerA: 1, playerB: 3 },
      statistics: {
        possession: { playerA: 46, playerB: 54 },
        shots: { playerA: 7, playerB: 11 },
      },
    });

    const oriented = orient(extraction(), flipped);
    expect(oriented.score).toEqual({ playerA: 3, playerB: 1 });
    expect(oriented.playerA.name).toBe('Mutaz Omar');

    const verdict = crossVerify(extraction(), flipped, OPTIONS);
    expect(verdict.outcome).toBe('verified');
  });

  it('catches screenshots from a different match', () => {
    const otherMatch = extraction({
      playerA: { name: 'Ali Hassan', team: 'Bayern', logoDetected: true },
      playerB: { name: 'Omar Said', team: 'Milan', logoDetected: true },
    });
    const verdict = crossVerify(extraction(), otherMatch, OPTIONS);
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('identity_mismatch');
  });

  it('checks the readings against the registered participants', () => {
    const verdict = crossVerify(extraction(), extraction(), {
      ...OPTIONS,
      expectedNames: { playerA: ['شخص آخر'], playerB: ['لاعب ثالث'] },
    });
    expect(verdict.outcome).toBe('review_required');
    expect(verdict.reasons).toContain('identity_mismatch');
  });

  it('accepts either orientation against the registered participants', () => {
    const verdict = crossVerify(extraction(), extraction(), {
      ...OPTIONS,
      expectedNames: { playerA: ['Ahmed Waad'], playerB: ['Mutaz Omar'] },
    });
    expect(verdict.outcome).toBe('verified');
  });

  it('does not treat an unread field as disagreement', () => {
    const verdict = crossVerify(
      extraction(),
      extraction({ playerA: { name: 'Mutaz Omar', team: null, logoDetected: false } }),
      OPTIONS,
    );
    expect(verdict.outcome).toBe('verified');
  });
});

describe('name normalisation', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normalize('Mutaz  Omar')).toBe(normalize('mutaz-omar'));
  });

  it('folds Arabic orthographic variants', () => {
    expect(normalize('أحمد')).toBe(normalize('احمد'));
    expect(normalize('حمزة')).toBe(normalize('حمزه'));
  });
});
