import { createServerSupabase } from '@/lib/supabase/server';
import { JoinByCode } from '@/components/player/JoinByCode';
import { PendingRequests } from '@/components/player/PendingRequests';

/**
 * The whole join flow in one block: the code field, and whatever the player
 * has already asked for.
 *
 * It appears in two places — the dedicated page, and the portal's "you are not
 * in a tournament yet" screen — because those are the same moment for the
 * person looking at them, and sending them from one to the other would only
 * add a step between a player and the code in their hand.
 */
export async function JoinPrompt() {
  const supabase = await createServerSupabase();

  // join_requests_select returns the caller's own rows; a request belonging to
  // anyone else is not in this result at all.
  const { data: requests } = await supabase
    .from('tournament_join_requests')
    .select('id, tournament_id, status, created_at, decision_note')
    .order('created_at', { ascending: false })
    .limit(10);

  const tournamentIds = [...new Set((requests ?? []).map((r) => r.tournament_id))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };

  return (
    <>
      <JoinByCode />
      <PendingRequests
        rows={(requests ?? []).map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.created_at,
          decisionNote: r.decision_note,
          // The name is only known for a tournament the request is on; an
          // unreadable one shows as a plain request rather than a blank row.
          tournamentName: tournaments?.find((t) => t.id === r.tournament_id)?.name ?? 'بطولة',
        }))}
      />
    </>
  );
}
