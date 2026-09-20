import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { MarkAllRead } from '@/components/MarkAllRead';

export const metadata = { title: 'الإشعارات' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard/notifications');

  const supabase = await createServerSupabase();
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60);

  const unread = (notifications ?? []).filter((n) => n.read_at === null).length;

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px', maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div className="eyebrow">مركز الإشعارات</div>
          <h1 style={{ fontSize: 30, marginBlockStart: 8 }}>الإشعارات</h1>
        </div>
        {unread > 0 ? <MarkAllRead /> : null}
      </div>

      {!notifications || notifications.length === 0 ? (
        <div
          className="panel"
          style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', marginBlockStart: 24 }}
        >
          لا توجد إشعارات.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '24px 0 0', padding: 0, display: 'grid', gap: 8 }}>
          {notifications.map((n) => {
            const content = (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <strong style={{ fontSize: 15 }}>{n.title}</strong>
                  <time
                    dateTime={n.created_at}
                    className="numeric"
                    style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                  >
                    {new Date(n.created_at).toLocaleDateString('ar', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </time>
                </div>
                {n.body ? (
                  <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
                    {n.body}
                  </p>
                ) : null}
              </>
            );

            return (
              <li
                key={n.id}
                className="panel"
                style={{
                  padding: '14px 16px',
                  borderInlineStartWidth: n.read_at ? 1 : 3,
                  borderInlineStartColor: n.read_at ? 'var(--line)' : 'var(--accent)',
                }}
              >
                {n.link ? <Link href={n.link}>{content}</Link> : content}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
