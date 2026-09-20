import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';

export const metadata = { title: 'لوحة الإدارة' };
export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin');

  const supabase = await createServerSupabase();

  // RLS already restricts tournament_admins to tournaments this user can see.
  const { data: adminRows } = await supabase
    .from('tournament_admins')
    .select('tournament_id, role')
    .eq('user_id', user.id);

  const ids = (adminRows ?? []).map((r) => r.tournament_id);

  const { data: tournaments } = ids.length
    ? await supabase
        .from('tournaments')
        .select('id, slug, name, status, capacity, player_count, accent_color')
        .in('id', ids)
        .order('created_at', { ascending: false })
    : { data: [] };

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="eyebrow">مركز القيادة</div>
          <h1 style={{ fontSize: 32, marginBlockStart: 8 }}>لوحة الإدارة</h1>
        </div>
        <Link href="/admin/tournaments/new" className="btn btn-primary">
          بطولة جديدة
        </Link>
      </div>

      {!tournaments || tournaments.length === 0 ? (
        <div
          className="panel"
          style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', marginBlockStart: 28 }}
        >
          لا تدير أي بطولة بعد.
        </div>
      ) : (
        <ul
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            listStyle: 'none',
            margin: '28px 0 0',
            padding: 0,
          }}
        >
          {tournaments.map((t) => (
            <li key={t.id} className="panel" style={{ padding: 18 }}>
              <div
                aria-hidden
                style={{ height: 3, width: 48, background: t.accent_color, marginBlockEnd: 12 }}
              />
              <Link href={`/admin/tournaments/${t.id}`}>
                <h2 style={{ fontSize: 18, marginBlockEnd: 10 }}>{t.name}</h2>
              </Link>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="tag">{STATUS_LABELS_AR[t.status as TournamentStatus]}</span>
                <span className="tag numeric">
                  {t.player_count} / {t.capacity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
