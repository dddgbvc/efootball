'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ActivityRow {
  id: number;
  kind: string;
  message: string;
  created_at: string;
}

/**
 * Subscribes to this tournament's activity only. The row filter narrows the
 * stream and the table's SELECT policy narrows it again, so a viewer never
 * receives events from a tournament they cannot see.
 */
export function ActivityStream({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: ActivityRow[];
}) {
  const [rows, setRows] = useState<ActivityRow[]>(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`activity:${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tournament_activity',
          filter: `tournament_id=eq.${tournamentId}`,
        },
        (payload) => {
          const row = payload.new as ActivityRow;
          setRows((current) => [row, ...current].slice(0, 20));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  return (
    <section className="panel strip" style={{ padding: '18px 20px 20px' }}>
      <div className="eyebrow" style={{ marginBlockEnd: 12 }}>
        نبض البطولة
      </div>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>لا يوجد نشاط بعد.</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          {rows.map((row) => (
            <li
              key={row.id}
              className="animate-rise"
              style={{
                display: 'grid',
                gridTemplateColumns: '54px 1fr',
                gap: 10,
                paddingBlock: 7,
                borderBottom: '1px solid var(--line)',
                fontSize: 14,
              }}
            >
              <time
                dateTime={row.created_at}
                className="numeric"
                style={{ color: 'var(--text-muted)', fontSize: 12 }}
                dir="ltr"
              >
                {new Date(row.created_at).toLocaleTimeString('ar', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              <span>{row.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
