'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * Unread counter, kept live over Realtime.
 *
 * The subscription is filtered to this user's own rows and the notifications
 * table's RLS policy restricts the stream to the same set, so nothing another
 * player receives is ever delivered here.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null);

      if (!cancelled) setUnread(count ?? 0);

      const channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => setUnread((n) => n + 1),
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }

    const cleanup = load();
    return () => {
      cancelled = true;
      void cleanup.then((fn) => fn?.());
    };
  }, []);

  return (
    <Link
      href="/dashboard/notifications"
      aria-label={unread > 0 ? `${unread} إشعار غير مقروء` : 'الإشعارات'}
      style={{ position: 'relative', display: 'inline-flex', padding: 6 }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      {unread > 0 ? (
        <span
          className="numeric"
          style={{
            position: 'absolute',
            insetInlineEnd: 0,
            insetBlockStart: 0,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            fontSize: 10,
            fontWeight: 800,
            lineHeight: '16px',
            textAlign: 'center',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
