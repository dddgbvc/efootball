import type { TournamentPreset, TournamentRules } from './types';

export const DEFAULT_RULES: TournamentRules = {
  matchDurationMinutes: 15,
  leagueEnabled: true,
  leagueDoubleRound: true,
  leagueExtraTime: false,
  leaguePenalties: false,
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  tiebreakers: ['points', 'goal_difference', 'goals_for', 'head_to_head'],
  directSemifinalSlots: 2,
  playoffSlots: 4,
  knockoutTwoLegs: true,
  knockoutExtraTime: true,
  knockoutPenalties: true,
  awayGoalsRule: false,
  semifinalDrawMode: 'seeded',
  thirdPlaceMatch: false,
  bigWinGoalDiff: 4,
  aiMinConfidence: 0.85,
  aiStatisticTolerance: 0.15,
};

export interface PresetDefinition {
  id: TournamentPreset;
  nameAr: string;
  descriptionAr: string;
  capacities: number[];
  /**
   * Only presets whose engine is actually implemented and covered by tests are
   * offered to admins. The rest stay visible but disabled so the product never
   * advertises a format it cannot run.
   */
  productionReady: boolean;
  rules: Partial<TournamentRules>;
}

export const PRESETS: PresetDefinition[] = [
  {
    id: 'league8_double_playoffs',
    nameAr: 'دوري 8 + تصفيات',
    descriptionAr:
      'دوري من ثمانية لاعبين ذهاباً وإياباً، يتأهل الأول والثاني مباشرة لنصف النهائي، ويخوض أصحاب المراكز 3–6 تصفيات ذهاب وإياب.',
    capacities: [8],
    productionReady: true,
    rules: { ...DEFAULT_RULES },
  },
  {
    id: 'league8_double',
    nameAr: 'دوري 8 ذهاب وإياب',
    descriptionAr: 'دوري كامل من ثمانية لاعبين ذهاباً وإياباً، والبطل هو صاحب المركز الأول.',
    capacities: [8],
    productionReady: true,
    rules: {
      ...DEFAULT_RULES,
      directSemifinalSlots: 0,
      playoffSlots: 0,
    },
  },
  {
    id: 'knockout8',
    nameAr: 'خروج المغلوب 8',
    descriptionAr: 'ثمانية لاعبين، أدوار إقصائية ذهاب وإياب من ربع النهائي حتى النهائي.',
    capacities: [8],
    productionReady: false,
    rules: { ...DEFAULT_RULES, leagueEnabled: false, directSemifinalSlots: 0, playoffSlots: 8 },
  },
  {
    id: 'knockout16',
    nameAr: 'خروج المغلوب 16',
    descriptionAr: 'ستة عشر لاعباً، أدوار إقصائية ذهاب وإياب.',
    capacities: [16],
    productionReady: false,
    rules: { ...DEFAULT_RULES, leagueEnabled: false, directSemifinalSlots: 0, playoffSlots: 16 },
  },
  {
    id: 'groups_knockout',
    nameAr: 'مجموعات + إقصائي',
    descriptionAr: 'مجموعات ثم أدوار إقصائية.',
    capacities: [16],
    productionReady: false,
    rules: { ...DEFAULT_RULES },
  },
  {
    id: 'custom',
    nameAr: 'مخصص',
    descriptionAr: 'ابدأ من الإعدادات الافتراضية وعدّل القوانين يدوياً قبل انطلاق البطولة.',
    capacities: [8, 16],
    productionReady: true,
    rules: { ...DEFAULT_RULES },
  },
];

export function getPreset(id: TournamentPreset): PresetDefinition {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown preset: ${id}`);
  return found;
}

export function productionReadyPresets(capacity?: number): PresetDefinition[] {
  return PRESETS.filter(
    (p) => p.productionReady && (capacity === undefined || p.capacities.includes(capacity)),
  );
}

export function rulesForPreset(id: TournamentPreset): TournamentRules {
  return { ...DEFAULT_RULES, ...getPreset(id).rules };
}
