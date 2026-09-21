import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';

const SECTIONS = [
  ['', 'لوحة التحكم'],
  ['players', 'اللاعبون'],
  ['requests', 'الطلبات'],
  ['check-in', 'الحضور'],
  ['matches', 'المباريات'],
  ['disputes', 'النزاعات'],
  ['draw', 'القرعة'],
  ['news', 'الأخبار'],
  ['moderation', 'البلاغات'],
  ['settings', 'الإعدادات'],
  ['audit', 'سجل التدقيق'],
] as const;

export default async function AdminTournamentLayout(props: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/admin/tournaments/${id}`);

  // The tournament SELECT policy only exposes rows the caller may see. Check
  // admin membership from the same caller-scoped client instead of requiring
  // a server-wide service-role secret just to render the admin shell.
  const supabase = await createServerSupabase();
  const [{ data: tournament }, { data: adminRow }, { data: profile }] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, name, slug, accent_color, created_by')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('tournament_admins')
      .select('user_id')
      .eq('tournament_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', user.id)
      .maybeSingle(),
  ]);

  if (!tournament) notFound();
  if (
    tournament.created_by !== user.id &&
    !adminRow &&
    profile?.is_platform_admin !== true
  ) {
    notFound();
  }

  return (
    <div className="shell" style={{ paddingBlock: '28px 80px' }}>
      <div
        aria-hidden
        style={{ height: 4, width: 64, background: tournament.accent_color, marginBlockEnd: 14 }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ fontSize: 26 }}>{tournament.name}</h1>
        <Link
          href={`/tournaments/${tournament.slug}`}
          style={{ fontSize: 13, color: 'var(--text-muted)' }}
        >
          عرض الصفحة العامة ←
        </Link>
      </div>

      <nav
        aria-label="أقسام الإدارة"
        style={{
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
          marginBlock: '18px 24px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {SECTIONS.map(([path, label]) => (
          <Link
            key={path}
            href={`/admin/tournaments/${id}${path ? `/${path}` : ''}`}
            style={{
              padding: '9px 13px',
              whiteSpace: 'nowrap',
              fontSize: 13,
              color: 'var(--text-muted)',
            }}
          >
            {label}
          </Link>
        ))}
      </nav>

      {props.children}
    </div>
  );
}
