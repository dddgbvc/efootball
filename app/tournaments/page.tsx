import Link from 'next/link';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { EmptyState } from '@/components/StandingsTable';
import { JoinByCode } from '@/components/player/JoinByCode';

export const metadata = { title: 'البطولات' };
// The page now shows the join panel to whoever is signed in, so it is rendered
// per request rather than cached for twenty seconds and served to everybody.
export const dynamic = 'force-dynamic';

export default async function TournamentsPage() {
  const supabase = await createServerSupabase();
  const user = await getCurrentUser();
  const { data } = await supabase
    .from('tournaments')
    .select('id, slug, name, description, status, capacity, player_count, accent_color, starts_at')
    .neq('status', 'draft')
    .order('created_at', { ascending: false });

  const tournaments = data ?? [];

  return (
    <div className="shell" style={{ paddingBlock: '40px 72px' }}>
      <div className="eyebrow">الأرشيف</div>
      <h1 style={{ fontSize: 34, marginBlock: '10px 22px' }}>البطولات</h1>

      {/*
        The way in, at the top of the page people open when they are looking
        for a tournament. Only public ones are listed below, so for everybody
        holding a code this panel *is* the page: sending them to find the
        field somewhere else is a step that loses people.
      */}
      <section style={{ marginBlockEnd: 28 }}>
        {user ? (
          <>
            <div className="eyebrow">معك كود بطولة؟</div>
            <h2 style={{ fontSize: 20, marginBlock: '8px 6px' }}>انضم بكود البطولة</h2>
            <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-muted)' }}>
              أدخل الكود الذي أرسله لك منظّم البطولة، فيصله طلبك ويقرّر.
            </p>
            <JoinByCode />
          </>
        ) : (
          <div className="panel strip" style={{ padding: '20px 22px 22px' }}>
            <div className="eyebrow">معك كود بطولة؟</div>
            <h2 style={{ fontSize: 20, marginBlock: '8px 8px' }}>انضم بكود البطولة</h2>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-muted)' }}>
              يرسل لك منظّم البطولة كوداً من ثمانية أحرف. سجّل دخولك ثم أدخله، فيصله طلبك.
            </p>
            <Link href="/login?next=/player/join" className="btn btn-primary">
              سجّل دخولك للانضمام بالكود
            </Link>
          </div>
        )}
      </section>

      {tournaments.length === 0 ? (
        <EmptyState>
          لا توجد بطولات عامة معروضة. البطولات الخاصة لا تظهر هنا — يدخلها اللاعب بالكود
          الذي يرسله له منظّمها.
        </EmptyState>
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
