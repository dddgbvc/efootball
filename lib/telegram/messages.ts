import type { InlineButton } from './client';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface Composed {
  text: string;
  buttons: InlineButton[];
}

export function firstEvidenceMessage(args: {
  tournamentName: string;
  tournamentId: string;
  matchId: string;
  submitter: string;
  waitingOn: string;
}): Composed {
  return {
    text: [
      '📥 <b>تم استلام توثيق نتيجة</b>',
      '',
      `<b>البطولة:</b> ${escapeHtml(args.tournamentName)}`,
      `<b>المباراة:</b> ${escapeHtml(args.submitter)} × ${escapeHtml(args.waitingOn)}`,
      '',
      `✅ ${escapeHtml(args.submitter)} أرسل صورة النتيجة`,
      `⏳ بقي توثيق ${escapeHtml(args.waitingOn)}`,
    ].join('\n'),
    buttons: [
      {
        text: 'فتح المباراة',
        url: appUrl(`/admin/tournaments/${args.tournamentId}/matches/${args.matchId}`),
      },
    ],
  };
}

export function secondEvidenceMessage(args: {
  tournamentName: string;
  tournamentId: string;
  matchId: string;
  playerA: string;
  playerB: string;
}): Composed {
  return {
    text: [
      '🧠 <b>اكتمل التوثيق — جاري التحقق بالذكاء الاصطناعي</b>',
      '',
      `<b>البطولة:</b> ${escapeHtml(args.tournamentName)}`,
      `<b>المباراة:</b> ${escapeHtml(args.playerA)} × ${escapeHtml(args.playerB)}`,
    ].join('\n'),
    buttons: [
      {
        text: 'فتح المباراة',
        url: appUrl(`/admin/tournaments/${args.tournamentId}/matches/${args.matchId}`),
      },
    ],
  };
}

export function verifiedMessage(args: {
  tournamentId: string;
  matchId: string;
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
}): Composed {
  return {
    text: [
      '✅ <b>تم توثيق النتيجة بنجاح</b>',
      '',
      `${escapeHtml(args.playerA)} <b>${args.scoreA}</b>`,
      `${escapeHtml(args.playerB)} <b>${args.scoreB}</b>`,
      '',
      'تطابقت صور الطرفين.',
    ].join('\n'),
    buttons: [
      { text: 'فتح تفاصيل المباراة', url: appUrl(`/match/${args.matchId}`) },
      { text: 'عرض الترتيب', url: appUrl(`/admin/tournaments/${args.tournamentId}`) },
    ],
  };
}

export function mismatchMessage(args: {
  tournamentId: string;
  matchId: string;
  playerA: string;
  playerB: string;
  readingA: string;
  readingB: string;
  reasons: string[];
}): Composed {
  return {
    text: [
      '🚨 <b>يوجد اختلاف في توثيق النتيجة</b>',
      '',
      `<b>المباراة:</b> ${escapeHtml(args.playerA)} × ${escapeHtml(args.playerB)}`,
      '',
      `صورة ${escapeHtml(args.playerA)}:`,
      args.readingA,
      '',
      `صورة ${escapeHtml(args.playerB)}:`,
      args.readingB,
      '',
      `<b>السبب:</b> ${escapeHtml(args.reasons.map(reasonLabel).join('، '))}`,
      '<b>الحالة:</b> تحتاج مراجعة المسؤول',
    ].join('\n'),
    buttons: [
      {
        text: 'فتح القضية',
        url: appUrl(`/admin/tournaments/${args.tournamentId}/disputes?match=${args.matchId}`),
      },
    ],
  };
}

export function playerJoinedMessage(args: {
  tournamentName: string;
  tournamentId: string;
  player: string;
  count: number;
  capacity: number;
}): Composed {
  const full = args.count >= args.capacity;
  return {
    text: [
      full ? '🔒 <b>اكتمل عدد المشاركين</b>' : '👤 <b>لاعب جديد انضم</b>',
      '',
      `<b>البطولة:</b> ${escapeHtml(args.tournamentName)}`,
      `<b>اللاعب:</b> ${escapeHtml(args.player)}`,
      `<b>المشاركون:</b> ${args.count} / ${args.capacity}`,
    ].join('\n'),
    buttons: [
      {
        text: 'عرض البطولة',
        url: appUrl(`/admin/tournaments/${args.tournamentId}/players`),
      },
    ],
  };
}

export function drawCompletedMessage(args: {
  tournamentName: string;
  tournamentId: string;
  kind: 'playoff' | 'semifinal' | 'final';
  pairings: Array<{ playerA: string; playerB: string }>;
}): Composed {
  const title =
    args.kind === 'playoff'
      ? '🎲 <b>تمت قرعة التصفيات</b>'
      : args.kind === 'semifinal'
        ? '🎲 <b>تمت قرعة نصف النهائي</b>'
        : '🎲 <b>تم تحديد النهائي</b>';

  return {
    text: [
      title,
      '',
      `<b>البطولة:</b> ${escapeHtml(args.tournamentName)}`,
      '',
      ...args.pairings.map(
        (p, i) => `${i + 1}. ${escapeHtml(p.playerA)} × ${escapeHtml(p.playerB)}`,
      ),
    ].join('\n'),
    buttons: [
      { text: 'عرض القرعة', url: appUrl(`/admin/tournaments/${args.tournamentId}/draw`) },
    ],
  };
}

export function championMessage(args: {
  tournamentName: string;
  tournamentId: string;
  champion: string;
}): Composed {
  return {
    text: [
      '🏆 <b>تُوّج البطل</b>',
      '',
      `<b>البطولة:</b> ${escapeHtml(args.tournamentName)}`,
      `<b>البطل:</b> ${escapeHtml(args.champion)}`,
    ].join('\n'),
    buttons: [{ text: 'عرض البطولة', url: appUrl(`/admin/tournaments/${args.tournamentId}`) }],
  };
}

export function correctionRequestMessage(args: {
  tournamentId: string;
  matchId: string;
  player: string;
  reason: string;
}): Composed {
  return {
    text: [
      '✏️ <b>طلب تصحيح توثيق</b>',
      '',
      `<b>اللاعب:</b> ${escapeHtml(args.player)}`,
      `<b>السبب:</b> ${escapeHtml(args.reason)}`,
    ].join('\n'),
    buttons: [
      {
        text: 'فتح المباراة',
        url: appUrl(`/admin/tournaments/${args.tournamentId}/matches/${args.matchId}`),
      },
    ],
  };
}

export function aiUnavailableMessage(args: {
  tournamentId: string;
  matchId: string;
  playerA: string;
  playerB: string;
  detail: string;
}): Composed {
  return {
    text: [
      '⚠️ <b>تعذر التحقق الآلي</b>',
      '',
      `<b>المباراة:</b> ${escapeHtml(args.playerA)} × ${escapeHtml(args.playerB)}`,
      `<b>التفاصيل:</b> ${escapeHtml(args.detail)}`,
      '',
      'الأدلة محفوظة. المباراة بانتظار مراجعة يدوية.',
    ].join('\n'),
    buttons: [
      {
        text: 'فتح القضية',
        url: appUrl(`/admin/tournaments/${args.tournamentId}/disputes?match=${args.matchId}`),
      },
    ],
  };
}

export function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    score_mismatch: 'اختلاف في النتيجة',
    identity_mismatch: 'اختلاف في هوية اللاعبين',
    team_mismatch: 'اختلاف في الفرق أو الشعارات',
    statistics_mismatch: 'اختلاف في الإحصائيات',
    low_confidence: 'ثقة منخفضة',
    invalid_result_screen: 'الصورة ليست شاشة نتيجة صالحة',
    unreadable_evidence: 'تعذر قراءة الصورة',
    ai_unavailable: 'خدمة التحليل غير متاحة',
    correction_request: 'طلب تصحيح',
    admin_opened: 'فتحها المسؤول',
  };
  return labels[reason] ?? reason;
}
