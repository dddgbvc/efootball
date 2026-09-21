import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadPlayerContext, loadPlayerMatches } from '@/lib/player/context';
import { loadStandings } from '@/lib/tournament/queries';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import { Avatar } from '@/components/player/Avatar';
import { NextMatchCard } from '@/components/player/NextMatchCard';
import { StandingsBoard } from '@/components/player/StandingsBoard';

export const dynamic = 'force-dynamic';

export default async function PlayerHomePage() {
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player/rules');

  const { context } = result;
  const supabase = await createServerSupabase();

  const [matches, bundle, { count: unreadCount }, { data: lastMessages }] = await Promise.all([
    loadPlayerMatches(context.tournament.id, context.userId),
    loadStandings(supabase, context.tournament.id),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', context.userId)
      .is('read_at', null),
    supabase
      .from('chat_messages')
      .select('id, body, created_at, sender_id, room_id')
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  const senderIds = [
    ...new Set((lastMessages ?? []).map((m) => m.sender_id).filter((x): x is string => x !== null)),
  ];
  const { data: senders } = senderIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', senderIds)
    : { data: [] };

  const myRow = bundle.standings.find((s) => s.playerId === context.userId);

  return (
    <div className="player-page" data-stagger>
      {/* ---------------------------------------------------------------- */}
      <section className="player-greeting">
        <Avatar path={context.avatarPath} name={context.displayName} size={48} />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ fontSize: 10 }}>
            {STATUS_LABELS_AR[context.tournament.status]}
          </div>
          <h1 style={{ fontSize: 22, marginBlockStart: 2 }}>مرحباً، {context.displayName}</h1>
        </div>
      </section>

      {/* Organiser-written status. Absent means absent — no invented default. */}
      <section className="panel" style={{ padding: '14px 16px 16px' }}>
        <div className="eyebrow">حالتك</div>
        {context.membership.publicStatus ? (
          <>
            <div style={{ fontSize: 17, fontWeight: 700, marginBlockStart: 6 }}>
              {context.membership.publicStatus}
            </div>
            {context.membership.publicNote ? (
              <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 600 }}>ملاحظة المنظم: </span>
                {context.membership.publicNote}
              </p>
            ) : null}
          </>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            لم يحدّد المنظّم حالة لك بعد.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="player-section-title">المباراة القادمة</h2>
        <NextMatchCard
          match={matches.next}
          hasHiddenNext={matches.hasHiddenNext}
          viewer={{ name: context.displayName, avatarPath: context.avatarPath }}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section>
        <div className="player-section-head">
          <h2 className="player-section-title">ترتيب البطولة</h2>
          <Link href="/player/standings" style={{ fontSize: 13, color: 'var(--accent)' }}>
            عرض الكل ←
          </Link>
        </div>
        <StandingsBoard
          standings={bundle.standings.slice(0, 5)}
          playersById={bundle.playersById}
          highlightId={context.userId}
          compact
        />
        {myRow && myRow.position > 5 ? (
          <div style={{ marginBlockStart: 8 }}>
            <StandingsBoard
              standings={[myRow]}
              playersById={bundle.playersById}
              highlightId={context.userId}
              compact
            />
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section>
        <div className="player-section-head">
          <h2 className="player-section-title">آخر الرسائل</h2>
          <Link href="/player/chat" style={{ fontSize: 13, color: 'var(--accent)' }}>
            المحادثات ←
          </Link>
        </div>
        {!lastMessages || lastMessages.length === 0 ? (
          <div className="panel player-empty">لا توجد رسائل بعد.</div>
        ) : (
          <ul className="player-list">
            {lastMessages.map((m) => (
              <li key={m.id} className="panel player-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {senders?.find((s) => s.id === m.sender_id)?.display_name ?? 'النظام'}
                  </div>
                  <div className="player-row-body">{m.body}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section>
        <div className="player-section-head">
          <h2 className="player-section-title">مبارياتي السابقة</h2>
          <Link href="/player/matches" style={{ fontSize: 13, color: 'var(--accent)' }}>
            الكل ←
          </Link>
        </div>
        {matches.finished.length === 0 ? (
          <div className="panel player-empty">لا توجد مباريات مكتملة حتى الآن.</div>
        ) : (
          <ul className="player-list">
            {matches.finished.slice(0, 3).map((m) => (
              <li key={m.id}>
                <Link href={`/player/matches/${m.id}`} className="panel card-link player-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {m.roundNumber ? `الجولة ${m.roundNumber}` : 'مباراة'}
                    </div>
                    <div style={{ fontWeight: 700 }}>ضد {m.opponentName}</div>
                  </div>
                  <span className="player-score">
                    <span>{m.isHome ? m.scoreA : m.scoreB}</span>
                    <span className="sep">-</span>
                    <span>{m.isHome ? m.scoreB : m.scoreA}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/player/notifications" className="btn" style={{ width: '100%' }}>
        الإشعارات
        {(unreadCount ?? 0) > 0 ? <span className="player-badge">{unreadCount}</span> : null}
      </Link>
    </div>
  );
}
