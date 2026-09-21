import { createServerSupabase } from '@/lib/supabase/server';
import { loadStandings } from '@/lib/tournament/queries';
import { RosterTable } from '@/components/admin/RosterTable';
import { PlayerStatusEditor, type PlayerStatusRow } from '@/components/admin/PlayerStatusEditor';

export const dynamic = 'force-dynamic';

export default async function AdminPlayersPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const { data: players } = await admin
    .from('tournament_players')
    .select(
      'id, user_id, status, joined_at, checked_in_at, approved_at, removal_reason, public_status, public_note, status_updated_at',
    )
    .eq('tournament_id', id)
    .order('joined_at', { ascending: true });

  const ids = (players ?? []).map((p) => p.user_id);

  const [
    { data: profiles },
    { data: acceptances },
    { data: privateNotes },
    { data: joinRequests },
    { data: rules },
    bundle,
  ] = await Promise.all([
    ids.length
      ? admin.from('profiles').select('id, display_name, efootball_name, platform').in('id', ids)
      : Promise.resolve({ data: [] }),
    admin
      .from('tournament_rule_acceptances')
      .select('user_id, accepted, rules_version, created_at')
      .eq('tournament_id', id)
      .order('created_at', { ascending: false }),
    admin.from('player_admin_notes').select('user_id, note').eq('tournament_id', id),
    admin
      .from('tournament_join_requests')
      .select('user_id, status, created_at, decided_at')
      .eq('tournament_id', id),
    admin.from('tournament_rules').select('version').eq('tournament_id', id).maybeSingle(),
    loadStandings(admin, id),
  ]);

  const currentVersion = rules?.version ?? 1;

  const rosterRows = (players ?? []).map((p) => {
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

  // The decisions arrive newest first, so the first match for a player against
  // the version in force is the one that counts.
  const statusRows: PlayerStatusRow[] = (players ?? []).map((p) => {
    const profile = profiles?.find((x) => x.id === p.user_id);
    const decision = acceptances?.find(
      (a) => a.user_id === p.user_id && a.rules_version === currentVersion,
    );
    const standing = bundle.standings.find((s) => s.playerId === p.user_id);
    const joinRequest = joinRequests?.find((r) => r.user_id === p.user_id);

    return {
      userId: p.user_id,
      displayName: profile?.display_name ?? '—',
      publicStatus: p.public_status,
      publicNote: p.public_note,
      privateNote: privateNotes?.find((n) => n.user_id === p.user_id)?.note ?? null,
      statusUpdatedAt: p.status_updated_at,
      rulesState: decision ? (decision.accepted ? 'accepted' : 'declined') : 'pending',
      joinState: joinRequest
        ? joinRequest.status === 'approved'
          ? 'انضم بطلب مقبول'
          : `طلب: ${joinRequest.status}`
        : 'أُضيف مباشرة',
      played: standing?.played ?? 0,
      points: standing?.points ?? 0,
    };
  });

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <section>
        <h2 className="eyebrow" style={{ marginBlockEnd: 12 }}>
          قائمة المشاركين
        </h2>
        <RosterTable tournamentId={id} rows={rosterRows} />
      </section>

      <section>
        <h2 className="eyebrow" style={{ marginBlockEnd: 12 }}>
          حالة اللاعبين والدعوات والقوانين
        </h2>
        <PlayerStatusEditor tournamentId={id} rows={statusRows} />
      </section>
    </div>
  );
}
