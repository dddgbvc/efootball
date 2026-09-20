import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadStandings } from '@/lib/tournament/queries';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { StageControls } from '@/components/supabase/StageControls';
import { ActivityPulse } from '@/components/ActivityPulse';

export const dynamic = 'force-dynamic';

export default async function AdminTournamentDashboard(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const supabase = await createServerSupabase();

  const [{ data: tournament }, bundle] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', id).single(),
    loadStandings(supabase, id),
  ]);

  if (!tournament) return null;

  const [{ count: pendingEvidence }, { count: disputes }, { data: rounds }] = await Promise.all([
    supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id)
      .in('status', ['awaiting_second_evidence', 'ai_verifying', 'awaiting_verification']),
    supabase
      .from('verification_cases')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id)
      .eq('status', 'open'),
    supabase
      .from('matches')
      .select('round_number, status')
      .eq('tournament_id', id)
      .eq('stage', 'league'),
  ]);

  // The current round is the lowest round that still has an unverified match.
  const currentRound =
    (rounds ?? [])
      .filter((r) => r.status !== 'verified' && r.status !== 'completed')
      .map((r) => r.round_number ?? Infinity)
      .sort((a, b) => a - b)[0] ?? null;

  const fallbackHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ??
    (fallbackHost ? `https://${fallbackHost}` : 'https://efootball-iota.vercel.app')
  ).replace(/\/$/, '');
  const publicTournamentUrl = `${appUrl}/tournaments/${encodeURIComponent(tournament.slug)}`;

  const tiles: Array<[string, string, string?]> = [
    ['المشاركون', `${tournament.player_count} / ${tournament.capacity}`],
    ['مرحلة البطولة', STATUS_LABELS_AR[tournament.status as TournamentStatus]],
    ['المباريات', `${bundle.verifiedMatches} / ${bundle.totalMatches}`],
    ['توثيقات معلقة', String(pendingEvidence ?? 0)],
    ['نزاعات', String(disputes ?? 0), (disputes ?? 0) > 0 ? 'alert' : undefined],
    [
      'الجولة الحالية',
      currentRound && Number.isFinite(currentRound) ? String(currentRound) : '—',
    ],
  ];

  return (
    <div style={{ display: 'grid', gap: 26 }}>
      <section
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        {tiles.map(([label, value, tone]) => (
          <div key={label} className="panel strip" style={{ padding: '14px 16px 18px' }}>
            <div className="eyebrow">{label}</div>
            <div
              className="numeric"
              style={{
                fontSize: 26,
                fontWeight: 800,
                marginBlockStart: 6,
                color: tone === 'alert' ? 'var(--color-alert-400)' : 'inherit',
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="panel strip" style={{ padding: '14px 16px 18px' }}>
        <div className="eyebrow">الرابط العام للبطولة</div>
        <a
          href={publicTournamentUrl}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          style={{
            display: 'block',
            marginBlockStart: 8,
            fontSize: 14,
            fontWeight: 700,
            overflowWrap: 'anywhere',
          }}
        >
          {publicTournamentUrl}
        </a>
      </section>

      <StageControls
        tournamentId={id}
        status={tournament.status as TournamentStatus}
        playerCount={tournament.player_count}
        capacity={tournament.capacity}
        leagueGenerated={bundle.totalMatches > 0}
        leagueComplete={bundle.totalMatches > 0 && bundle.verifiedMatches === bundle.totalMatches}
      />

      {(disputes ?? 0) > 0 ? (
        <Link
          href={`/supabase/tournaments/${id}/disputes`}
          className="panel"
          style={{
            padding: 18,
            borderColor: 'var(--color-alert-500)',
            color: 'var(--color-alert-400)',
            fontWeight: 700,
          }}
        >
          🚨 يوجد {disputes} نزاع مفتوح يحتاج قراراً ←
        </Link>
      ) : null}

      <ActivityPulse tournamentId={id} />
    </div>
  );
}
