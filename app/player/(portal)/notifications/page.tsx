import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadPlayerContext } from '@/lib/player/context';
import { MarkAllRead } from '@/components/MarkAllRead';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الإشعارات' };

export default async function PlayerNotificationsPage() {
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player');

  const supabase = await createServerSupabase();

  // notifications_own_select restricts this to the caller's own rows.
  const { data: rows } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(60);

  const notifications = rows ?? [];
  const unread = notifications.filter((n) => n.read_at === null);

  return (
    <div className="player-page">
      <div className="player-section-head">
        <h1 style={{ fontSize: 24 }}>الإشعارات</h1>
        {unread.length > 0 ? <MarkAllRead /> : null}
      </div>

      {notifications.length === 0 ? (
        <div className="panel player-empty">لا توجد إشعارات بعد.</div>
      ) : (
        <ul className="player-list">
          {notifications.map((n) => {
            const body = (
              <>
                <div className="player-row-head">
                  <span style={{ fontWeight: 700 }}>{n.title}</span>
                  {n.read_at === null ? <span className="player-dot" aria-label="غير مقروء" /> : null}
                </div>
                {n.body ? <div className="player-row-body">{n.body}</div> : null}
                <time
                  dateTime={n.created_at}
                  style={{ fontSize: 11, color: 'var(--text-muted)' }}
                >
                  {new Date(n.created_at).toLocaleString('ar', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </>
            );

            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="panel card-link player-notification">
                    {body}
                  </Link>
                ) : (
                  <div className="panel player-notification">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
