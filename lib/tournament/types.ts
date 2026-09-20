export type TournamentStatus =
  | 'draft'
  | 'registration_open'
  | 'registration_full'
  | 'check_in'
  | 'ready_for_draw'
  | 'league_active'
  | 'playoffs'
  | 'semifinal'
  | 'final'
  | 'completed'
  | 'cancelled';

export type TournamentPreset =
  | 'league8_double_playoffs'
  | 'league8_double'
  | 'knockout8'
  | 'knockout16'
  | 'groups_knockout'
  | 'custom';

export type MatchStage = 'league' | 'playoff' | 'semifinal' | 'third_place' | 'final';

export type SemifinalDrawMode = 'seeded' | 'open_draw';

export type Tiebreaker =
  | 'points'
  | 'goal_difference'
  | 'goals_for'
  | 'head_to_head'
  | 'goals_against'
  | 'wins';

export interface TournamentRules {
  matchDurationMinutes: number;
  leagueEnabled: boolean;
  leagueDoubleRound: boolean;
  leagueExtraTime: boolean;
  leaguePenalties: boolean;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: Tiebreaker[];
  directSemifinalSlots: number;
  playoffSlots: number;
  knockoutTwoLegs: boolean;
  knockoutExtraTime: boolean;
  knockoutPenalties: boolean;
  awayGoalsRule: boolean;
  semifinalDrawMode: SemifinalDrawMode;
  thirdPlaceMatch: boolean;
  bigWinGoalDiff: number;
  aiMinConfidence: number;
  aiStatisticTolerance: number;
}

export interface Fixture {
  roundNumber: number;
  leg: 1 | 2;
  playerA: string;
  playerB: string;
}

export interface LeagueResult {
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
}

export interface StandingRow {
  playerId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
  zone: QualificationZone;
  tiedWith: string[];
}

export type QualificationZone = 'direct_semifinal' | 'playoff' | 'eliminated' | 'none';

export interface TiePairing {
  position: number;
  playerA: string;
  playerB: string;
}
