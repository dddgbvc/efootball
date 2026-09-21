import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadPlayerContext, loadPlayerMatches } from '@/lib/player/context';
import { NextMatchCard, MATCH_STATE_LABEL } from '@/components/player/NextMatchCard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'مبارياتي' };

export default async function PlayerMatchesPage() {
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player');

  const { context } = result;
  const matches = await loadPlayerMatches(context.tournament.id, context.userId);

  return (
    <div className="player-page">
      <h1 style={{ fontSize: 24, marginBlockEnd: 6 }}>مبارياتي</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>
        مبارياتك وحدها. مباريات اللاعبين الآخرين ليست جزءاً من هذه الصفحة.
      </p>

      <section>
        <h2 className="player-section-title">المباراة القادمة</h2>
        <NextMatchCard
          match={matches.next}
          hasHiddenNext={matches.hasHiddenNext}
          viewer={{ name: context.displayName, avatarPath: context.avatarPath }}
        />
      </section>

      <section>
        <h2 className="player-section-title">المباريات السابقة</h2>
        {matches.finished.length === 0 ? (
          <div className="panel player-empty">لا توجد مباريات مكتملة حتى الآن.</div>
        ) : (
          <ul className="player-list">
            {matches.finished.map((m) => {
              const mine = m.isHome ? m.scoreA : m.scoreB;
              const theirs = m.isHome ? m.scoreB : m.scoreA;
              const outcome =
                mine === null || theirs === null
                  ? 'none'
                  : mine > theirs
                    ? 'win'
                    : mine < theirs
                      ? 'loss'
                      : 'draw';

              return (
                <li key={m.id}>
                  <Link
                    href={`/player/matches/${m.id}`}
                    className="panel card-link player-row"
                    data-outcome={outcome}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {m.roundNumber ? `الجولة ${m.roundNumber}` : 'مباراة'} ·{' '}
                        {MATCH_STATE_LABEL[m.status]}
                      </div>
                      <div style={{ fontWeight: 700 }}>ضد {m.opponentName}</div>
                    </div>
                    <span className="player-score">
                      <span>{mine ?? '—'}</span>
                      <span className="sep">-</span>
                      <span>{theirs ?? '—'}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
