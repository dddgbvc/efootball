import type { StandingRow } from '@/lib/tournament/types';

const ZONE_LABEL: Record<string, string> = {
  direct_semifinal: 'تأهل مباشر لنصف النهائي',
  playoff: 'التصفيات',
  eliminated: 'خروج',
};

/**
 * Header labels paired with the column role the stylesheet keys off. Everything
 * marked `secondary` is the per-result breakdown, which the phone breakpoint
 * drops so position, goal difference, points and form stay on screen.
 */
const COLUMNS: ReadonlyArray<readonly [label: string, col: string]> = [
  ['#', 'position'],
  ['اللاعب', 'player'],
  ['لعب', 'secondary'],
  ['فاز', 'secondary'],
  ['تعادل', 'secondary'],
  ['خسر', 'secondary'],
  ['له', 'secondary'],
  ['عليه', 'secondary'],
  ['+/-', 'gd'],
  ['نقاط', 'points'],
  ['الأداء', 'form'],
];

export function StandingsTable({
  standings,
  playersById,
}: {
  standings: StandingRow[];
  playersById: Map<string, { id: string; display_name: string; avatar_path: string | null }>;
}) {
  if (standings.length === 0) {
    return <EmptyState>لا يوجد ترتيب بعد — لم تُوثَّق أي مباراة.</EmptyState>;
  }

  const rows: React.ReactNode[] = [];
  let lastZone: string | null = null;

  for (const row of standings) {
    if (row.zone !== 'none' && row.zone !== lastZone) {
      lastZone = row.zone;
      rows.push(
        <tr className="zone-divider" key={`zone-${row.zone}`}>
          <td colSpan={11}>{ZONE_LABEL[row.zone]}</td>
        </tr>,
      );
    }

    const player = playersById.get(row.playerId);
    rows.push(
      <tr key={row.playerId} data-zone={row.zone}>
        <td data-col="position" style={{ fontWeight: 800, width: 42 }}>
          {row.position}
        </td>
        <td data-col="player" style={{ minWidth: 150 }}>
          <span style={{ fontWeight: 600 }}>{player?.display_name ?? '—'}</span>
          {row.tiedWith.length > 0 ? (
            <span className="tag" style={{ marginInlineStart: 8, borderColor: 'var(--accent)' }}>
              تعادل يحتاج حسماً
            </span>
          ) : null}
        </td>
        <td data-col="secondary">{row.played}</td>
        <td data-col="secondary">{row.won}</td>
        <td data-col="secondary">{row.drawn}</td>
        <td data-col="secondary">{row.lost}</td>
        <td data-col="secondary">{row.goalsFor}</td>
        <td data-col="secondary">{row.goalsAgainst}</td>
        <td data-col="gd">
          <span className="signed">
            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
          </span>
        </td>
        <td data-col="points" style={{ fontWeight: 800 }}>
          {row.points}
        </td>
        <td data-col="form">
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {row.form.map((f, i) => (
              <span
                key={i}
                title={f}
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 18,
                  height: 18,
                  fontSize: 10,
                  fontWeight: 800,
                  borderRadius: 2,
                  background:
                    f === 'W'
                      ? 'var(--color-pitch-500)'
                      : f === 'D'
                        ? 'var(--line-strong)'
                        : 'var(--color-alert-500)',
                  color: '#fff',
                }}
              >
                {f}
              </span>
            ))}
          </span>
        </td>
      </tr>,
    );
  }

  return (
    <div className="panel standings" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <caption className="sr-only">جدول ترتيب الدوري</caption>
        <thead>
          <tr style={{ textAlign: 'start' }}>
            {COLUMNS.map(([label, col]) => (
              <th
                key={label}
                scope="col"
                data-col={col}
                style={{
                  padding: '10px 12px',
                  textAlign: 'start',
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--line)',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <style>{`table td { padding: 10px 12px; border-bottom: 1px solid var(--line); }`}</style>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="panel"
      style={{
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </div>
  );
}
