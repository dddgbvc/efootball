import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadStandings, loadRules } from '@/lib/tournament/queries';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { TournamentFlowRail } from '@/components/TournamentFlowRail';
import { StandingsTable, EmptyState } from '@/components/StandingsTable';
import { MatchList } from '@/components/MatchList';
import { RulesSheet } from '@/components/RulesSheet';
import { NewsFeed } from '@/components/NewsFeed';
import { BracketView } from '@/components/BracketView';
import { ActivityPulse } from '@/components/ActivityPulse';

const TABS = [
  ['home', 'الرئيسية'],
  ['news', 'آخر الأخبار'],
  ['standings', 'الترتيب'],
  ['matches', 'المباريات'],
  ['draw', 'القرعة'],
  ['bracket', 'التصفيات'],
  ['stats', 'الإحصائيات'],
  ['rules', 'القوانين'],
] as const;

type Tab = (typeof TABS)[number][0];

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('tournaments')
    .select('name, description, cover_path, capacity, player_count')
    .eq('slug', slug)
    .maybeSingle();

  if (!data) return { title: 'بطولة غير موجودة' };

  const description =
    data.description ??
    `بطولة eFootball بعدد ${data.capacity} لاعبين — ${data.player_count} مشارك حتى الآن.`;

  return {
    title: data.name,
    description,
    openGraph: {
      title: data.name,
      description,
      images: data.cover_path ? [publicUrl('tournament-media', data.cover_path)] : undefined,
    },
  };
}

function publicUrl(bucket: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

export default async function TournamentPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await props.params;
  const { tab: rawTab } = await props.searchParams;
  const tab: Tab = (TABS.find(([id]) => id === rawTab)?.[0] ?? 'home') as Tab;

  const supabase = await createServerSupabase();
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!tournament) notFound();

  const [rules, bundle] = await Promise.all([
    loadRules(supabase, tournament.id),
    loadStandings(supabase, tournament.id),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="shell" style={{ paddingBlock: '32px 80px' }}>
      <header style={{ marginBlockEnd: 28 }}>
        <div
          aria-hidden
          style={{ height: 4, width: 72, background: tournament.accent_color, marginBlockEnd: 16 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
          <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', letterSpacing: '-0.03em' }}>
            {tournament.name}
          </h1>
          <span className="tag">{STATUS_LABELS_AR[tournament.status as TournamentStatus]}</span>
          <span className="tag numeric">
            {tournament.player_count} / {tournament.capacity}
          </span>
          {tournament.champion_id ? (
            <span className="tag" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              🏆 {bundle.playersById.get(tournament.champion_id)?.display_name ?? 'البطل'}
            </span>
          ) : null}
        </div>
        {tournament.description ? (
          <p style={{ color: 'var(--text-muted)', maxWidth: 680, marginBlockStart: 10 }}>
            {tournament.description}
          </p>
        ) : null}
      </header>

      <TournamentFlowRail
        status={tournament.status as TournamentStatus}
        leagueProgress={{ verified: bundle.verifiedMatches, total: bundle.totalMatches }}
      />

      <nav
        aria-label="أقسام البطولة"
        style={{
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
          marginBlock: '28px 20px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {TABS.map(([id, label]) => (
          <Link
            key={id}
            href={`/tournaments/${slug}?tab=${id}`}
            aria-current={tab === id ? 'page' : undefined}
            className="tab-link"
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'home' ? (
        <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0,1fr)' }}>
          <StandingsTable standings={bundle.standings.slice(0, 8)} playersById={bundle.playersById} />
          <ActivityPulse tournamentId={tournament.id} />
        </div>
      ) : null}

      {tab === 'standings' ? (
        <StandingsTable standings={bundle.standings} playersById={bundle.playersById} />
      ) : null}

      {tab === 'matches' ? (
        <MatchList tournamentId={tournament.id} currentUserId={user?.id ?? null} />
      ) : null}

      {tab === 'news' ? <NewsFeed tournamentId={tournament.id} /> : null}

      {tab === 'bracket' || tab === 'draw' ? (
        <BracketView tournamentId={tournament.id} showDraw={tab === 'draw'} />
      ) : null}

      {tab === 'rules' ? <RulesSheet rules={rules} capacity={tournament.capacity} /> : null}

      {tab === 'stats' ? (
        <TournamentStats tournamentId={tournament.id} bundle={bundle} />
      ) : null}
    </div>
  );
}

async function TournamentStats({
  tournamentId,
  bundle,
}: {
  tournamentId: string;
  bundle: Awaited<ReturnType<typeof loadStandings>>;
}) {
  const supabase = await createServerSupabase();

  const { data: extractions } = await supabase
    .from('ai_extractions')
    .select('match_id, statistics, score_a, score_b, status')
    .eq('status', 'succeeded')
    .in(
      'match_id',
      (
        await supabase
          .from('matches')
          .select('id')
          .eq('tournament_id', tournamentId)
          .eq('status', 'verified')
      ).data?.map((m) => m.id) ?? [],
    );

  if (bundle.standings.length === 0) {
    return <EmptyState>لا توجد إحصائيات بعد — لم تُوثَّق أي مباراة.</EmptyState>;
  }

  const topScorer = [...bundle.standings].sort((a, b) => b.goalsFor - a.goalsFor)[0];
  const mostWins = [...bundle.standings].sort((a, b) => b.won - a.won)[0];
  const bestGd = [...bundle.standings].sort((a, b) => b.goalDifference - a.goalDifference)[0];

  // Possession is only shown when it was actually read off the screenshots.
  const possession = new Map<string, number[]>();
  for (const row of extractions ?? []) {
    const stats = row.statistics as Record<string, { playerA: number; playerB: number }> | null;
    const p = stats?.possession;
    if (!p) continue;
    push(possession, `${row.match_id}:a`, p.playerA);
    push(possession, `${row.match_id}:b`, p.playerB);
  }

  const cards = [
    ['أكثر أهداف', topScorer ? bundle.playersById.get(topScorer.playerId)?.display_name : null, topScorer?.goalsFor],
    ['أكثر انتصارات', mostWins ? bundle.playersById.get(mostWins.playerId)?.display_name : null, mostWins?.won],
    ['أفضل فارق أهداف', bestGd ? bundle.playersById.get(bestGd.playerId)?.display_name : null, bestGd?.goalDifference],
    ['مباريات موثقة', `${bundle.verifiedMatches} من ${bundle.totalMatches}`, null],
  ] as const;

  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      }}
    >
      {cards.map(([label, value, figure]) => (
        <div key={label} className="panel strip" style={{ padding: '18px 18px 20px' }}>
          <div className="eyebrow">{label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBlockStart: 8 }}>{value ?? '—'}</div>
          {figure !== null && figure !== undefined ? (
            <div className="score-figure signed" style={{ fontSize: 32, marginBlockStart: 6 }}>
              {figure}
            </div>
          ) : null}
        </div>
      ))}
      {possession.size === 0 ? (
        <div className="panel" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 14 }}>
          لم تُستخرج نسب استحواذ من الصور بعد.
        </div>
      ) : null}
    </div>
  );
}

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
