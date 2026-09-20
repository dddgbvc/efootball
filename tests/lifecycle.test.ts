import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, flowRailIndex } from '@/lib/tournament/lifecycle';
import { getPreset, productionReadyPresets, rulesForPreset } from '@/lib/tournament/presets';

describe('tournament state machine', () => {
  it('allows the happy path through the whole tournament', () => {
    const path = [
      ['draft', 'registration_open'],
      ['registration_open', 'registration_full'],
      ['registration_full', 'check_in'],
      ['check_in', 'ready_for_draw'],
      ['ready_for_draw', 'league_active'],
      ['league_active', 'playoffs'],
      ['playoffs', 'semifinal'],
      ['semifinal', 'final'],
      ['final', 'completed'],
    ] as const;

    for (const [from, to] of path) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('refuses to skip straight from draft to a live league', () => {
    expect(canTransition('draft', 'league_active')).toBe(false);
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(() => assertTransition('draft', 'final')).toThrow('INVALID_STATUS_TRANSITION');
  });

  it('treats completed and cancelled as terminal', () => {
    expect(canTransition('completed', 'league_active')).toBe(false);
    expect(canTransition('cancelled', 'draft')).toBe(false);
  });

  it('cannot go backwards from the knockout stage', () => {
    expect(canTransition('semifinal', 'league_active')).toBe(false);
    expect(canTransition('final', 'semifinal')).toBe(false);
  });

  it('maps live stages onto the flow rail', () => {
    expect(flowRailIndex('league_active')).toBe(0);
    expect(flowRailIndex('playoffs')).toBe(2);
    expect(flowRailIndex('completed')).toBe(5);
    expect(flowRailIndex('draft')).toBe(-1);
  });
});

describe('rule engine presets', () => {
  it('only offers presets whose engine is implemented', () => {
    for (const preset of productionReadyPresets()) {
      expect(preset.productionReady).toBe(true);
    }
    expect(getPreset('knockout16').productionReady).toBe(false);
  });

  it('filters presets by capacity', () => {
    const forEight = productionReadyPresets(8).map((p) => p.id);
    expect(forEight).toContain('league8_double_playoffs');
    expect(forEight).not.toContain('knockout16');
  });

  it('builds the primary 8-player ruleset from §12–§20', () => {
    const rules = rulesForPreset('league8_double_playoffs');
    expect(rules.matchDurationMinutes).toBe(15);
    expect(rules.leagueDoubleRound).toBe(true);
    expect(rules.leagueExtraTime).toBe(false);
    expect(rules.leaguePenalties).toBe(false);
    expect(rules.pointsWin).toBe(3);
    expect(rules.pointsDraw).toBe(1);
    expect(rules.pointsLoss).toBe(0);
    expect(rules.directSemifinalSlots).toBe(2);
    expect(rules.playoffSlots).toBe(4);
    expect(rules.knockoutTwoLegs).toBe(true);
    expect(rules.knockoutExtraTime).toBe(true);
    expect(rules.knockoutPenalties).toBe(true);
    expect(rules.awayGoalsRule).toBe(false);
    expect(rules.semifinalDrawMode).toBe('seeded');
  });

  it('the league-only preset has no knockout slots', () => {
    const rules = rulesForPreset('league8_double');
    expect(rules.directSemifinalSlots).toBe(0);
    expect(rules.playoffSlots).toBe(0);
  });

  it('rejects an unknown preset', () => {
    // @ts-expect-error deliberately invalid preset id
    expect(() => getPreset('nope')).toThrow('Unknown preset');
  });
});
