import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { EmptyState } from '@/components/StandingsTable';

export const metadata = { title: 'البطولات' };
export const revalidate = 20;

export default async function TournamentsPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('tournaments')
    .select('id, slug, name, description, status, capacity, player_count, accent_color, starts_at')
    .neq('status', 'draft')
    .order('created_at', { ascending: false });

  const tournaments = data ?? [];

  return (
    <div className="shell" style={{ paddingBlock: '40px 72px' }}>
      <div className="eyebrow">الأرشيف</div>
      <h1 style={{ fontSize: 34, marginBlock: '10px 28px' }}>البطولات</h1>

      {tournaments.length === 0 ? (
        <EmptyState>لا توجد بطولات متاحة لك حالياً.</EmptyState>
      ) : (
        <ul
          data-stagger
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {tournaments.map((t) => {
            const full = t.player_count >= t.capacity;
            return (
              <li key={t.id}>
                <Link
                  href={`/tournaments/${t.slug}`}
                  className="panel card-link"
                  style={{ padding: 20 }}
                >
                  <span
                    aria-hidden
                    className="rule"
                    style={{ background: t.accent_color, marginBlockEnd: 16 }}
                  />
                  <h2 style={{ fontSize: 19, marginBlockEnd: 6, letterSpacing: '-0.02em' }}>
                    {t.name}
                  </h2>
                  {t.description ? (
                    <p
                      style={{
                        fontSize: 14,
                        color: 'var(--text-muted)',
                        margin: '0 0 14px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {t.description}
                    </p>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="tag">{STATUS_LABELS_AR[t.status as TournamentStatus]}</span>
                    <span
                      className="tag numeric"
                      style={full ? { borderColor: 'var(--color-alert-500)' } : undefined}
                    >
                      {t.player_count} / {t.capacity}
                    </span>
                    {full ? <span className="tag">اكتمل العدد</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
