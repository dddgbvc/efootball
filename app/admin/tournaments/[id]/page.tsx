import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadStandings } from '@/lib/tournament/queries';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { StageControls } from '@/components/admin/StageControls';
import { JoinCodeCard } from '@/components/admin/JoinCodeCard';
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

  const [
    { count: pendingEvidence },
    { count: disputes },
    { data: rounds },
    { data: joinCode },
    { count: pendingRequests },
  ] = await Promise.all([
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
    supabase.from('tournament_join_codes').select('code').eq('tournament_id', id).maybeSingle(),
    supabase
      .from('tournament_join_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id)
      .eq('status', 'pending'),
  ]);

  // The current round is the lowest round that still has an unverified match.
  const currentRound =
    (rounds ?? [])
      .filter((r) => r.status !== 'verified' && r.status !== 'completed')
      .map((r) => r.round_number ?? Infinity)
      .sort((a, b) => a - b)[0] ?? null;

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

      <JoinCodeCard
        tournamentId={id}
        code={joinCode?.code ?? null}
        accepting={
          tournament.status === 'registration_open' || tournament.status === 'registration_full'
        }
        pendingRequests={pendingRequests ?? 0}
      />

      {tournament.status === 'draft' ? (
        <section
          className="panel"
          style={{ padding: '16px 18px 18px', borderColor: 'var(--color-amber-signal)' }}
        >
          <strong style={{ color: 'var(--color-amber-signal)' }}>البطولة ما زالت مسوّدة</strong>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            لا يراها أحد غيرك ولا يستطيع أي لاعب إرسال طلب انضمام. افتح التسجيل من «مراحل
            البطولة» أسفل الصفحة لتبدأ.
          </p>
        </section>
      ) : null}

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
          href={`/admin/tournaments/${id}/disputes`}
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
