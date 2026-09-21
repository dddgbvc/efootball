import { createServerSupabase } from '@/lib/supabase/server';
import { JoinRequestQueue, type JoinRequestRow } from '@/components/admin/JoinRequestQueue';

export const dynamic = 'force-dynamic';

/**
 * Who has asked to join, and what the organiser decided.
 *
 * Read under the organiser's own session: join_requests_select returns their
 * own tournament's requests and nothing else, so this page cannot show a
 * request belonging to somebody else's tournament even by mistake.
 */
export default async function AdminRequestsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createServerSupabase();

  const [{ data: requests }, { data: tournament }] = await Promise.all([
    supabase
      .from('tournament_join_requests')
      .select('id, user_id, status, message, created_at, decided_at, decision_note')
      .eq('tournament_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('tournaments')
      .select('status, player_count, capacity')
      .eq('id', id)
      .maybeSingle(),
  ]);

  const userIds = [...new Set((requests ?? []).map((r) => r.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase
        .from('profiles')
        .select('id, display_name, avatar_path, efootball_name, platform')
        .in('id', userIds)
    : { data: [] };

  const rows: JoinRequestRow[] = (requests ?? []).map((r) => {
    const profile = profiles?.find((p) => p.id === r.user_id);
    return {
      id: r.id,
      userId: r.user_id,
      displayName: profile?.display_name ?? 'لاعب',
      avatarPath: profile?.avatar_path ?? null,
      efootballName: profile?.efootball_name ?? null,
      platform: profile?.platform ?? null,
      status: r.status,
      message: r.message,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      decisionNote: r.decision_note,
    };
  });

  const accepting =
    tournament?.status === 'registration_open' || tournament?.status === 'registration_full';
  const seatsLeft = (tournament?.capacity ?? 0) - (tournament?.player_count ?? 0);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h2 className="eyebrow" style={{ marginBlockEnd: 8 }}>
          طلبات الانضمام
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
          {accepting
            ? `${seatsLeft > 0 ? `${seatsLeft} مقعد متبقٍ` : 'اكتمل العدد'} — الطلب لا يحجز مقعداً، المقعد يُحجز عند قبولك.`
            : 'التسجيل مغلق حالياً، فلن تُقبل أي طلبات حتى تفتحه من لوحة التحكم.'}
        </p>
      </div>

      <JoinRequestQueue tournamentId={id} rows={rows} canDecide={accepting} />
    </div>
  );
}
