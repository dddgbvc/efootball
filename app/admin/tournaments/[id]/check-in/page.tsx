import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminCheckInPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const [{ data: tournament }, { data: players }] = await Promise.all([
    admin
      .from('tournaments')
      .select('status, check_in_opens_at, check_in_closes_at')
      .eq('id', id)
      .maybeSingle(),
    admin
      .from('tournament_players')
      .select('user_id, status, checked_in_at, approved_at')
      .eq('tournament_id', id),
  ]);

  const ids = (players ?? []).map((p) => p.user_id);
  const { data: profiles } = ids.length
    ? await admin.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] };

  const nameOf = (uid: string) => profiles?.find((p) => p.id === uid)?.display_name ?? '—';

  const registered = (players ?? []).filter((p) =>
    ['registered', 'approved', 'checked_in', 'no_show'].includes(p.status),
  );
  const approved = registered.filter((p) => p.approved_at !== null);
  const checkedIn = registered.filter((p) => p.checked_in_at !== null);
  const noShow = registered.filter((p) => p.checked_in_at === null);

  const tiles: Array<[string, number]> = [
    ['مسجّل', registered.length],
    ['معتمد', approved.length],
    ['أكّد الحضور', checkedIn.length],
    ['لم يؤكد', noShow.length],
  ];

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        {tiles.map(([label, value]) => (
          <div key={label} className="panel strip" style={{ padding: '14px 16px 18px' }}>
            <div className="eyebrow">{label}</div>
            <div className="numeric" style={{ fontSize: 26, fontWeight: 800, marginBlockStart: 6 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {tournament?.status !== 'check_in' ? (
        <div className="panel" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 14 }}>
          مرحلة تأكيد الحضور غير مفتوحة حالياً. افتحها من لوحة التحكم.
        </div>
      ) : null}

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              {['اللاعب', 'الحالة', 'وقت التأكيد'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  style={{
                    textAlign: 'start',
                    padding: '10px 12px',
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {registered.map((p) => (
              <tr key={p.user_id}>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                  {nameOf(p.user_id)}
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                  <span
                    className="tag"
                    style={{
                      borderColor: p.checked_in_at
                        ? 'var(--color-pitch-400)'
                        : 'var(--line-strong)',
                    }}
                  >
                    {p.checked_in_at ? 'حاضر' : 'لم يؤكد'}
                  </span>
                </td>
                <td
                  className="numeric"
                  style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}
                >
                  {p.checked_in_at ? new Date(p.checked_in_at).toLocaleString('ar') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
