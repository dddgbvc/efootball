import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { reasonLabel } from '@/lib/telegram/messages';

export const dynamic = 'force-dynamic';

export default async function AdminDisputesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const { data: cases } = await admin
    .from('verification_cases')
    .select('id, match_id, status, reason, detail, opened_at, resolved_at, resolution, resolution_reason')
    .eq('tournament_id', id)
    .order('status', { ascending: true })
    .order('opened_at', { ascending: false });

  const matchIds = [...new Set((cases ?? []).map((c) => c.match_id))];
  const { data: matches } = matchIds.length
    ? await admin
        .from('matches')
        .select('id, player_a, player_b, stage, round_number, score_a, score_b')
        .in('id', matchIds)
    : { data: [] };

  const playerIds = [
    ...new Set((matches ?? []).flatMap((m) => [m.player_a, m.player_b])),
  ];
  const { data: profiles } = playerIds.length
    ? await admin.from('profiles').select('id, display_name').in('id', playerIds)
    : { data: [] };

  const nameOf = (uid: string) => profiles?.find((p) => p.id === uid)?.display_name ?? '—';

  if (!cases || cases.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        لا توجد نزاعات.
      </div>
    );
  }

  return (
    <ul style={{ display: 'grid', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
      {cases.map((c) => {
        const match = matches?.find((m) => m.id === c.match_id);
        const detail = c.detail as { reasons?: string[]; readings?: Record<string, unknown>; detail?: string } | null;

        return (
          <li
            key={c.id}
            className="panel"
            style={{
              padding: '16px 18px',
              borderInlineStartWidth: 3,
              borderInlineStartColor:
                c.status === 'open' ? 'var(--color-alert-500)' : 'var(--color-pitch-500)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="eyebrow">{c.status === 'open' ? 'قضية مفتوحة' : 'محسومة'}</div>
                <strong style={{ fontSize: 16 }}>
                  {match ? `${nameOf(match.player_a)} × ${nameOf(match.player_b)}` : c.match_id}
                </strong>
              </div>
              <time
                dateTime={c.opened_at}
                className="numeric"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
              >
                {new Date(c.opened_at).toLocaleString('ar')}
              </time>
            </div>

            <p style={{ fontSize: 14, marginBlock: '10px 6px' }}>
              السبب: <strong>{reasonLabel(c.reason)}</strong>
            </p>

            {detail?.reasons && detail.reasons.length > 0 ? (
              <ul style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 0 }}>
                {detail.reasons.map((r) => (
                  <li key={r}>{reasonLabel(r)}</li>
                ))}
              </ul>
            ) : null}
            {detail?.detail ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{detail.detail}</p>
            ) : null}

            {c.resolution ? (
              <p style={{ fontSize: 13, color: 'var(--color-pitch-400)' }}>
                القرار: {c.resolution}
                {c.resolution_reason ? ` — ${c.resolution_reason}` : ''}
              </p>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginBlockStart: 10, flexWrap: 'wrap' }}>
              <Link href={`/match/${c.match_id}`} className="btn" style={{ minHeight: 34, fontSize: 13 }}>
                فحص الأدلة
              </Link>
              <Link
                href={`/admin/tournaments/${id}/matches`}
                className="btn btn-primary"
                style={{ minHeight: 34, fontSize: 13 }}
              >
                اعتماد نتيجة رسمية
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
