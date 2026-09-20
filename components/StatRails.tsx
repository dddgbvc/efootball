const STAT_LABEL_AR: Record<string, string> = {
  possession: 'الاستحواذ',
  shots: 'التسديدات',
  shots_on_target: 'على المرمى',
  passes: 'التمريرات',
  successful_passes: 'تمريرات ناجحة',
  pass_accuracy: 'دقة التمرير',
  tackles: 'الالتحامات',
  saves: 'التصديات',
  corners: 'الركنيات',
  fouls: 'الأخطاء',
  offsides: 'التسلل',
  interceptions: 'الاعتراضات',
  yellow_cards: 'بطاقات صفراء',
  red_cards: 'بطاقات حمراء',
  dribbles: 'المراوغات',
  crosses: 'العرضيات',
  free_kicks: 'الركلات الحرة',
  expected_goals: 'الأهداف المتوقعة',
};

/**
 * Comparative statistic rails.
 *
 * The metric list is whatever the AI actually read off the screen — unknown
 * keys render with their raw name rather than being dropped, so a new eFootball
 * statistic needs no code change.
 */
export function StatRails({
  statistics,
  nameA,
  nameB,
}: {
  statistics: Record<string, { playerA: number; playerB: number; unit?: string }>;
  nameA: string;
  nameB: string;
}) {
  const entries = Object.entries(statistics);
  if (entries.length === 0) return null;

  return (
    <div className="panel" style={{ padding: '18px 20px 22px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          color: 'var(--text-muted)',
          marginBlockEnd: 16,
        }}
      >
        <span>{nameA}</span>
        <span>{nameB}</span>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {entries.map(([key, value]) => {
          const total = value.playerA + value.playerB;
          const pctA = total > 0 ? (value.playerA / total) * 100 : 50;
          const label = STAT_LABEL_AR[key] ?? key.replace(/_/g, ' ');

          return (
            <div key={key}>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBlockEnd: 6,
                }}
              >
                {label}
                {value.unit ? ` (${value.unit})` : ''}
              </div>
              <div className="stat-rail">
                <span className="numeric" style={{ fontWeight: 800 }}>
                  {formatNumber(value.playerA)}
                </span>
                <div
                  className="stat-rail-track"
                  role="img"
                  aria-label={`${label}: ${nameA} ${value.playerA}، ${nameB} ${value.playerB}`}
                >
                  <span className="stat-rail-fill" style={{ width: `${pctA}%` }} />
                  <span className="stat-rail-fill-b" style={{ width: `${100 - pctA}%` }} />
                </div>
                <span className="numeric" style={{ fontWeight: 800, textAlign: 'end' }}>
                  {formatNumber(value.playerB)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
