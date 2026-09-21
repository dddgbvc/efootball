import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadPlayerContext } from '@/lib/player/context';
import { loadStandings } from '@/lib/tournament/queries';
import { StandingsBoard } from '@/components/player/StandingsBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الترتيب' };

export default async function PlayerStandingsPage() {
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player');

  const { context } = result;
  const supabase = await createServerSupabase();
  const bundle = await loadStandings(supabase, context.tournament.id);

  return (
    <div className="player-page">
      <h1 style={{ fontSize: 24, marginBlockEnd: 6 }}>ترتيب البطولة</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
        محسوب من النتائج الموثقة وحدها — {bundle.verifiedMatches} من {bundle.totalMatches} مباراة.
      </p>

      {bundle.qualification.unresolvedTies.length > 0 ? (
        <p
          role="status"
          style={{ color: 'var(--color-amber-signal)', fontSize: 13, margin: '0 0 12px' }}
        >
          يوجد تعادل في الترتيب لم يُحسم بعد.
        </p>
      ) : null}

      <StandingsBoard
        standings={bundle.standings}
        playersById={bundle.playersById}
        highlightId={context.userId}
      />
    </div>
  );
}
