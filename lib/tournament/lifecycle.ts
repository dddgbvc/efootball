import type { TournamentStatus } from './types';

/**
 * Mirror of app.valid_status_transition() in migration 0700. Both exist on
 * purpose: this one gives the UI and the server routes an early, readable
 * failure; the database one is what actually holds the line.
 */
const TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  draft: ['registration_open', 'cancelled'],
  registration_open: ['registration_full', 'check_in', 'ready_for_draw', 'cancelled', 'draft'],
  registration_full: ['check_in', 'ready_for_draw', 'registration_open', 'cancelled'],
  check_in: ['ready_for_draw', 'registration_full', 'cancelled'],
  ready_for_draw: ['league_active', 'playoffs', 'semifinal', 'cancelled'],
  league_active: ['playoffs', 'semifinal', 'completed', 'cancelled'],
  playoffs: ['semifinal', 'cancelled'],
  semifinal: ['final', 'cancelled'],
  final: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: TournamentStatus, to: TournamentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: TournamentStatus): TournamentStatus[] {
  return [...TRANSITIONS[from]];
}

export function assertTransition(from: TournamentStatus, to: TournamentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_STATUS_TRANSITION: ${from} -> ${to}`);
  }
}

export const STATUS_LABELS_AR: Record<TournamentStatus, string> = {
  draft: 'مسودة',
  registration_open: 'التسجيل مفتوح',
  registration_full: 'اكتمل العدد',
  check_in: 'تأكيد الحضور',
  ready_for_draw: 'جاهزة للقرعة',
  league_active: 'الدوري',
  playoffs: 'التصفيات',
  semifinal: 'نصف النهائي',
  final: 'النهائي',
  completed: 'انتهت',
  cancelled: 'ملغاة',
};

/** The stages shown on the Tournament Flow Rail, in order. */
export const FLOW_RAIL_STAGES = [
  { key: 'league_active', label: 'الدوري' },
  { key: 'standings', label: 'الترتيب' },
  { key: 'playoffs', label: 'التصفيات' },
  { key: 'semifinal', label: 'نصف النهائي' },
  { key: 'final', label: 'النهائي' },
  { key: 'completed', label: 'البطل' },
] as const;

export function flowRailIndex(status: TournamentStatus): number {
  switch (status) {
    case 'league_active':
      return 0;
    case 'playoffs':
      return 2;
    case 'semifinal':
      return 3;
    case 'final':
      return 4;
    case 'completed':
      return 5;
    default:
      return -1;
  }
}
