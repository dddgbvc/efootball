import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { MATCH_STATUS_LABEL } from '@/components/MatchList';
import { CheckInButton } from '@/components/CheckInButton';
import type { MatchStatus } from '@/types/database';

export const metadata = { title: 'لوحتي' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard');

  const supabase = await createServerSupabase();

  // A tournament reaches this page two ways: the player joined it, or they
  // organize it. Listing only the first hid every tournament an organizer
  // created from the very page they land on afterwards.
  const [{ data: memberships }, { data: organizerRows }] = await Promise.all([
    supabase
      .from('tournament_players')
      .select('tournament_id, status, checked_in_at')
      .eq('user_id', user.id),
    supabase.from('tournament_admins').select('tournament_id').eq('user_id', user.id),
  ]);

  const organizedIds = new Set((organizerRows ?? []).map((r) => r.tournament_id));
  const tournamentIds = [
    ...new Set([...(memberships ?? []).map((m) => m.tournament_id), ...organizedIds]),
  ];

  const [{ data: tournaments }, { data: matches }, { data: unreadNotifications }] =
    await Promise.all([
      tournamentIds.length
        ? supabase
            .from('tournaments')
            .select('id, slug, name, status, capacity, player_count, accent_color, check_in_closes_at')
            .in('id', tournamentIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from('matches')
        .select('id, tournament_id, stage, round_number, leg, player_a, player_b, score_a, score_b, status')
        .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
        .not('status', 'in', '("verified","completed","cancelled")')
        .order('round_number', { ascending: true, nullsFirst: false })
        .limit(10),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null),
    ]);

  const opponentIds = [
    ...new Set((matches ?? []).flatMap((m) => [m.player_a, m.player_b])),
  ].filter((id) => id !== user.id);

  const { data: opponents } = opponentIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', opponentIds)
    : { data: [] };

  const nameOf = (id: string) => opponents?.find((p) => p.id === id)?.display_name ?? '—';
  const tournamentOf = (id: string) => tournaments?.find((t) => t.id === id);

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px' }}>
      <div className="eyebrow">لوحة اللاعب</div>
      <h1 style={{ fontSize: 32, marginBlock: '10px 28px' }}>أهلاً بك</h1>

      <section className="strip" style={{ marginBlockEnd: 34 }}>
        <h2 style={{ fontSize: 19, marginBlockEnd: 14 }}>مبارياتي القادمة</h2>
        {!matches || matches.length === 0 ? (
          <div className="panel" style={{ padding: 28, color: 'var(--text-muted)' }}>
            لا توجد مباريات معلقة.
          </div>
        ) : (
          <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {matches.map((match) => {
              const opponent = match.player_a === user.id ? match.player_b : match.player_a;
              const t = tournamentOf(match.tournament_id);
              return (
                <li key={match.id}>
                  <Link
                    href={`/match/${match.id}`}
                    className="panel"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t?.name}
                        {match.round_number ? ` · الجولة ${match.round_number}` : ''}
                      </div>
                      <div style={{ fontWeight: 700 }}>ضد {nameOf(opponent)}</div>
                    </div>
                    <span className="tag">{MATCH_STATUS_LABEL[match.status as MatchStatus]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="strip">
        <h2 style={{ fontSize: 19, marginBlockEnd: 14 }}>بطولاتي</h2>
        {!tournaments || tournaments.length === 0 ? (
          <div className="panel" style={{ padding: 28, color: 'var(--text-muted)' }}>
            لم تنضم إلى أي بطولة بعد.{' '}
            <Link href="/tournaments" style={{ color: 'var(--accent)' }}>
              تصفح البطولات
            </Link>{' '}
            أو{' '}
            <Link href="/admin/tournaments/new" style={{ color: 'var(--accent)' }}>
              أنشئ بطولتك
            </Link>
            .
          </div>
        ) : (
          <ul
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            {tournaments.map((t) => {
              const membership = memberships?.find((m) => m.tournament_id === t.id);
              const needsCheckIn = t.status === 'check_in' && !membership?.checked_in_at;
              const organizes = organizedIds.has(t.id);

              return (
                <li key={t.id} className="panel" style={{ padding: 18 }}>
                  <div
                    aria-hidden
                    style={{ height: 3, width: 48, background: t.accent_color, marginBlockEnd: 12 }}
                  />
                  <Link href={`/tournaments/${t.slug}`}>
                    <h3 style={{ fontSize: 17, marginBlockEnd: 8 }}>{t.name}</h3>
                  </Link>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBlockEnd: 12 }}>
                    <span className="tag">{STATUS_LABELS_AR[t.status as TournamentStatus]}</span>
                    <span className="tag numeric">
                      {t.player_count} / {t.capacity}
                    </span>
                    {organizes ? (
                      <span className="tag" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                        تديرها
                      </span>
                    ) : null}
                    {membership?.checked_in_at ? <span className="tag">حاضر ✓</span> : null}
                  </div>
                  {organizes ? (
                    <Link href={`/admin/tournaments/${t.id}`} className="btn" style={{ minHeight: 34 }}>
                      إدارة البطولة
                    </Link>
                  ) : null}
                  {needsCheckIn ? <CheckInButton tournamentId={t.id} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav style={{ display: 'flex', gap: 12, marginBlockStart: 36, flexWrap: 'wrap' }}>
        <Link href="/dashboard/profile" className="btn">
          الملف الشخصي
        </Link>
        <Link href="/dashboard/notifications" className="btn">
          الإشعارات{unreadNotifications ? '' : ''}
        </Link>
        <Link href="/messages" className="btn">
          الرسائل
        </Link>
        <Link href="/admin" className="btn">
          لوحة الإدارة
        </Link>
      </nav>
    </div>
  );
}
