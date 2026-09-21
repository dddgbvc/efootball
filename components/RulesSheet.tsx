import type { TournamentRules } from '@/lib/tournament/types';

const TIEBREAKER_LABEL: Record<string, string> = {
  points: 'النقاط',
  goal_difference: 'فارق الأهداف',
  goals_for: 'الأهداف المسجلة',
  goals_against: 'الأهداف المستقبَلة',
  head_to_head: 'المواجهة المباشرة',
  wins: 'عدد الانتصارات',
};

/**
 * Rendered entirely from the stored rule row.
 *
 * There is no second copy of the rules written as prose anywhere, so the page
 * can never drift from what the engine actually enforces (§70).
 */
export function RulesSheet({
  rules,
  capacity,
}: {
  rules: TournamentRules;
  capacity: number;
}) {
  const rows: Array<[string, string]> = [
    ['عدد اللاعبين', String(capacity)],
    [
      'نظام البطولة',
      rules.leagueEnabled
        ? rules.playoffSlots > 0
          ? 'دوري + تصفيات'
          : 'دوري'
        : 'خروج المغلوب',
    ],
    ['مدة المباراة', `${rules.matchDurationMinutes} دقيقة`],
    ['الدوري', rules.leagueDoubleRound ? 'ذهاب وإياب' : 'مباراة واحدة'],
    ['الوقت الإضافي في الدوري', rules.leagueExtraTime ? 'نعم' : 'لا'],
    ['ركلات الترجيح في الدوري', rules.leaguePenalties ? 'نعم' : 'لا'],
    ['النقاط', `فوز ${rules.pointsWin} · تعادل ${rules.pointsDraw} · خسارة ${rules.pointsLoss}`],
    [
      'ترتيب الحسم عند التعادل',
      rules.tiebreakers.map((t) => TIEBREAKER_LABEL[t] ?? t).join(' ← '),
    ],
    ['التصفيات', rules.knockoutTwoLegs ? 'ذهاب وإياب' : 'مباراة واحدة'],
    [
      'الوقت الإضافي',
      rules.knockoutExtraTime ? 'بعد الإياب إذا تعادل المجموع' : 'لا',
    ],
    ['ركلات الترجيح', rules.knockoutPenalties ? 'نعم' : 'لا'],
    ['قاعدة الهدف خارج الأرض', rules.awayGoalsRule ? 'نعم' : 'لا'],
    [
      'قرعة نصف النهائي',
      rules.semifinalDrawMode === 'seeded'
        ? 'مصنّفة — الأول والثاني لا يلتقيان'
        : 'قرعة مفتوحة',
    ],
  ];

  if (rules.directSemifinalSlots > 0 || rules.playoffSlots > 0) {
    const direct = rules.directSemifinalSlots;
    const playoffEnd = direct + rules.playoffSlots;
    rows.push([
      'التأهل',
      [
        direct > 0 ? `1–${direct} ← نصف النهائي` : null,
        rules.playoffSlots > 0 ? `${direct + 1}–${playoffEnd} ← التصفيات` : null,
        playoffEnd < capacity ? `${playoffEnd + 1}–${capacity} ← خروج` : null,
      ]
        .filter(Boolean)
        .join('  ·  '),
    ]);
  }

  rows.push([
    'توثيق النتائج',
    `صورتان من الطرفين · حد الثقة ${Math.round(rules.aiMinConfidence * 100)}%`,
  ]);
  rows.push(['تصنيف الاكتساح', `فارق ${rules.bigWinGoalDiff} أهداف فأكثر`]);

  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <dl style={{ margin: 0 }}>
        {rows.map(([term, value]) => (
          <div key={term} className="fact-row">
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
