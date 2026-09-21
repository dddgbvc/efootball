import { createServerSupabase } from '@/lib/supabase/server';
import { RosterTable } from '@/components/admin/RosterTable';

export const dynamic = 'force-dynamic';

export default async function AdminPlayersPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const { data: players } = await admin
    .from('tournament_players')
    .select('id, user_id, status, joined_at, checked_in_at, approved_at, removal_reason')
    .eq('tournament_id', id)
    .order('joined_at', { ascending: true });

  const ids = (players ?? []).map((p) => p.user_id);
  const { data: profiles } = ids.length
    ? await admin
        .from('profiles')
        .select('id, display_name, efootball_name, platform')
        .in('id', ids)
    : { data: [] };

  const rows = (players ?? []).map((p) => {
    const profile = profiles?.find((x) => x.id === p.user_id);
    return {
      id: p.id,
      userId: p.user_id,
      displayName: profile?.display_name ?? '—',
      efootballName: profile?.efootball_name ?? null,
      platform: profile?.platform ?? null,
      status: p.status,
      joinedAt: p.joined_at,
      checkedInAt: p.checked_in_at,
      removalReason: p.removal_reason,
    };
  });

  return <RosterTable tournamentId={id} rows={rows} />;
}
