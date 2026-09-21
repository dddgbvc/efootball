import type { StandingRow } from '@/lib/tournament/types';
import { Avatar } from './Avatar';

const ZONE_LABEL: Record<string, string> = {
  direct_semifinal: 'تأهل مباشر لنصف النهائي',
  playoff: 'التصفيات',
  eliminated: 'خروج',
};

/**
 * Standings as rows, not as a shrunken table.
 *
 * A phone cannot hold eleven columns, and the usual answer — hide columns
 * until it fits — throws away the matches-played count, which is exactly what
 * tells a player whether the table above them is settled or simply further
 * along. So each player is one row: position, face, name, and the two numbers
 * that decide everything. The per-result breakdown appears from 720px up,
 * where there is room for it.
 */
export function StandingsBoard({
  standings,
  playersById,
  highlightId,
  compact = false,
}: {
  standings: StandingRow[];
  playersById: Map<string, { id: string; display_name: string; avatar_path: string | null }>;
  highlightId?: string;
  compact?: boolean;
}) {
  if (standings.length === 0) {
    return <div className="panel player-empty">لم تُوثَّق أي مباراة بعد، فالترتيب لم يبدأ.</div>;
  }

  const rows: React.ReactNode[] = [];
  let lastZone: string | null = null;

  for (const row of standings) {
    if (!compact && row.zone !== 'none' && row.zone !== lastZone) {
      lastZone = row.zone;
      rows.push(
        <li key={`zone-${row.zone}`} className="board-zone">
          {ZONE_LABEL[row.zone]}
        </li>,
      );
    }

    const player = playersById.get(row.playerId);
    const isMe = row.playerId === highlightId;

    rows.push(
      <li
        key={row.playerId}
        className="board-row panel"
        data-zone={row.zone}
        data-me={isMe ? 'true' : undefined}
      >
        <span className="board-position numeric">{row.position}</span>

        <Avatar path={player?.avatar_path ?? null} name={player?.display_name ?? '—'} size={34} />

        <span className="board-name">
          {player?.display_name ?? '—'}
          {isMe ? <span className="board-you">أنت</span> : null}
        </span>

        {/* Matches played stays on every screen: it is the difference between
            "second" and "second, having played two fewer". */}
        <span className="board-played numeric">
          لعب <b>{row.played}</b>
        </span>

        <span className="board-detail numeric" data-col="secondary">
          {row.won}ف · {row.drawn}ت · {row.lost}خ
        </span>

        <span className="board-detail numeric" data-col="secondary">
          <span className="signed">
            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
          </span>
        </span>

        <span className="board-points numeric">
          <b>{row.points}</b>
          <span className="board-points-unit">نقطة</span>
        </span>
      </li>,
    );
  }

  return <ol className="board">{rows}</ol>;
}
