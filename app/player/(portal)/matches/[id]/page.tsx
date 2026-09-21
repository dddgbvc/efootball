import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadPlayerContext, loadPlayerMatch } from '@/lib/player/context';
import { Avatar } from '@/components/player/Avatar';
import { MATCH_STATE_LABEL } from '@/components/player/NextMatchCard';
import type { MatchStatus } from '@/types/database';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'المباراة' };

export default async function PlayerMatchPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player');

  const { context } = result;
  const loaded = await loadPlayerMatch(id, context.userId);

  /*
   * One message for three different refusals — no such match, not yours, not
   * open yet — because telling them apart is exactly the information a player
   * should not have about a round they have not reached.
   */
  if (!loaded) {
    return (
      <div className="player-page">
        <div className="panel" style={{ padding: 24, borderColor: 'var(--color-alert-500)' }}>
          <strong style={{ color: 'var(--color-alert-400)' }}>
            ليس لديك صلاحية لعرض هذه المباراة
          </strong>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            إما أنها ليست من مبارياتك، أو أن جولتها لم تُفتح بعد. أكمل مباراتك الحالية أولاً.
          </p>
        </div>
        <Link href="/player/matches" className="btn" style={{ marginBlockStart: 16 }}>
          عودة إلى مبارياتي
        </Link>
      </div>
    );
  }

  const { match, isHome, opponentId, opponent } = loaded;
  const mine = isHome ? match.score_a : match.score_b;
  const theirs = isHome ? match.score_b : match.score_a;
  const settled = match.status === 'verified' || match.status === 'completed';

  return (
    <div className="player-page">
      <div className="eyebrow">
        {match.round_number ? `الجولة ${match.round_number}` : match.stage}
        {match.leg === 2 ? ' · إياب' : match.leg === 1 ? ' · ذهاب' : ''}
      </div>

      <article className="panel next-match" style={{ marginBlockStart: 10 }}>
        <div className="next-match-head">
          <span className="tag">{MATCH_STATE_LABEL[match.status as MatchStatus]}</span>
          {match.scheduled_at ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {new Date(match.scheduled_at).toLocaleString('ar', {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : null}
        </div>

        <div className="next-match-body">
          <div className="next-match-side">
            <Avatar path={context.avatarPath} name={context.displayName} size={48} />
            <span>{context.displayName}</span>
          </div>
          {settled ? (
            <span className="player-score player-score-lg">
              <span>{mine ?? '—'}</span>
              <span className="sep">-</span>
              <span>{theirs ?? '—'}</span>
            </span>
          ) : (
            <span className="next-match-vs">VS</span>
          )}
          <div className="next-match-side">
            <Avatar
              path={opponent?.avatar_path ?? null}
              name={opponent?.display_name ?? 'لاعب'}
              size={48}
            />
            <span>{opponent?.display_name ?? 'لاعب'}</span>
          </div>
        </div>

        {match.verification_note ? (
          <p className="next-match-meta">{match.verification_note}</p>
        ) : null}

        <div className="next-match-actions">
          {!settled ? (
            <Link href={`/match/${match.id}`} className="btn btn-primary">
              رفع صورة النتيجة
            </Link>
          ) : (
            <Link href={`/match/${match.id}`} className="btn">
              تفاصيل التوثيق
            </Link>
          )}
          <Link href={`/player/messages/new?to=${opponentId}`} className="btn">
            مراسلة الخصم
          </Link>
        </div>
      </article>

      {opponent?.efootball_name || opponent?.platform ? (
        <section className="panel" style={{ padding: 16, marginBlockStart: 14 }}>
          <div className="eyebrow">الخصم</div>
          <dl className="player-facts">
            {opponent.efootball_name ? (
              <>
                <dt>الاسم داخل اللعبة</dt>
                <dd dir="ltr">{opponent.efootball_name}</dd>
              </>
            ) : null}
            {opponent.platform ? (
              <>
                <dt>المنصة</dt>
                <dd dir="ltr">{opponent.platform}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
