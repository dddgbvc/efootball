import { createServerSupabase } from '@/lib/supabase/server';
import { AdminMatchBoard } from '@/components/admin/AdminMatchBoard';

export const dynamic = 'force-dynamic';

export default async function AdminMatchesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const { data: matches } = await admin
    .from('matches')
    .select(
      'id, stage, round_number, leg, tie_id, player_a, player_b, score_a, score_b, status, official_source, verification_note',
    )
    .eq('tournament_id', id)
    .order('stage', { ascending: true })
    .order('round_number', { ascending: true, nullsFirst: false })
    .order('leg', { ascending: true });

  const ids = [...new Set((matches ?? []).flatMap((m) => [m.player_a, m.player_b]))];
  const { data: profiles } = ids.length
    ? await admin.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] };

  const nameOf = (uid: string) => profiles?.find((p) => p.id === uid)?.display_name ?? '—';

  return (
    <AdminMatchBoard
      rows={(matches ?? []).map((m) => ({
        id: m.id,
        stage: m.stage,
        roundNumber: m.round_number,
        leg: m.leg,
        isKnockout: m.tie_id !== null,
        playerA: nameOf(m.player_a),
        playerB: nameOf(m.player_b),
        scoreA: m.score_a,
        scoreB: m.score_b,
        status: m.status,
        officialSource: m.official_source,
        note: m.verification_note,
      }))}
    />
  );
}
