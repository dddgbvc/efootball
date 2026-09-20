import { createServerSupabase } from '@/lib/supabase/server';
import { ActivityStream } from './ActivityStream';

/** نبض البطولة — the live activity rail (§66). */
export async function ActivityPulse({ tournamentId }: { tournamentId: string }) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('tournament_activity')
    .select('id, kind, message, created_at')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false })
    .limit(20);

  return <ActivityStream tournamentId={tournamentId} initial={data ?? []} />;
}
