import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { MATCH_STATUS_LABEL } from '@/components/MatchList';
import { EvidenceUploader } from '@/components/EvidenceUploader';
import { StatRails } from '@/components/StatRails';
import type { MatchStatus } from '@/types/database';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  league: 'الدوري',
  playoff: 'التصفيات',
  semifinal: 'نصف النهائي',
  third_place: 'المركز الثالث',
  final: 'النهائي',
};

function publicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/storage/v1/object/public/match-evidence/${path}`;
}

export async function generateMetadata(props: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await props.params;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('matches')
    .select('score_a, score_b, stage, tournament_id')
    .eq('id', matchId)
    .maybeSingle();

  if (!data) return { title: 'مباراة غير موجودة' };
  return {
    title:
      data.score_a !== null ? `نتيجة ${data.score_a} – ${data.score_b}` : 'تفاصيل المباراة',
  };
}

export default async function MatchPage(props: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await props.params;
  const supabase = await createServerSupabase();

  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();

  if (!match) notFound();

  const [
    { data: tournament },
    { data: profiles },
    { data: evidence },
    { data: extractions },
    { data: tie },
    { data: news },
    { data: decisions },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select('id, slug, name, accent_color')
      .eq('id', match.tournament_id)
      .single(),
    supabase.from('profiles').select('id, display_name, avatar_path').in('id', [match.player_a, match.player_b]),
    supabase
      .from('match_evidence')
      .select('id, uploaded_by, storage_path, created_at, version, superseded_at')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true }),
    supabase
      .from('ai_extractions')
      .select(
        'id, evidence_id, status, score_a, score_b, statistics, team_a_name, team_b_name, player_a_name, player_b_name, confidence_overall, valid_result_screen',
      )
      .eq('match_id', matchId),
    match.tie_id
      ? supabase
          .from('knockout_ties')
          .select('id, aggregate_a, aggregate_b, player_a, player_b, winner_id, status')
          .eq('id', match.tie_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('news_posts')
      .select('id, title, label, published_at')
      .eq('source_match_id', matchId)
      .eq('status', 'published'),
    supabase
      .from('verification_cases')
      .select('id, status, reason, resolution, resolution_reason, resolved_at')
      .eq('match_id', matchId)
      .order('opened_at', { ascending: false }),
    supabase.auth.getUser(),
  ]);

  if (!tournament) notFound();

  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? '—';
  const isParticipant =
    user !== null && (match.player_a === user.id || match.player_b === user.id);

  const activeEvidence = (evidence ?? []).filter((e) => e.superseded_at === null);
  const myEvidence = user ? activeEvidence.find((e) => e.uploaded_by === user.id) : undefined;

  const extractionFor = (evidenceId: string) =>
    extractions?.find((x) => x.evidence_id === evidenceId && x.status === 'succeeded');

  const mergedStats = extractions?.find((x) => x.status === 'succeeded')?.statistics as
    | Record<string, { playerA: number; playerB: number; unit?: string }>
    | undefined;

  return (
    <div className="shell" style={{ paddingBlock: '32px 80px', maxWidth: 1000 }}>
      <Link
        href={`/tournaments/${tournament.slug}?tab=matches`}
        style={{ fontSize: 13, color: 'var(--text-muted)' }}
      >
        ← {tournament.name}
      </Link>

      <div className="eyebrow" style={{ marginBlockStart: 14 }}>
        {STAGE_LABEL[match.stage] ?? match.stage}
        {match.round_number ? ` · الجولة ${match.round_number}` : ''}
        {match.stage !== 'league' ? ` · ${match.leg === 1 ? 'الذهاب' : 'الإياب'}` : ''}
      </div>

      {/* Split match layout: player A zone / central score / player B zone */}
      <section
        className="panel"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
          alignItems: 'center',
          gap: 16,
          padding: '26px 20px',
          marginBlock: '12px 24px',
        }}
      >
        <PlayerZone name={nameOf(match.player_a)} team={match.team_a} align="start" />
        <div style={{ textAlign: 'center' }}>
          <div className="score-figure animate-score" style={{ fontSize: 'clamp(2.4rem, 8vw, 4rem)' }}>
            {match.score_a ?? '–'} <span style={{ opacity: 0.35 }}>:</span> {match.score_b ?? '–'}
          </div>
          {match.penalties_a !== null && match.penalties_b !== null ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 4 }}>
              ترجيح {match.penalties_a} – {match.penalties_b}
            </div>
          ) : null}
          {tie ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 4 }}>
              المجموع {tie.aggregate_a} – {tie.aggregate_b}
            </div>
          ) : null}
          <div
            className="tag"
            style={{
              marginBlockStart: 10,
              borderColor:
                match.status === 'review_required'
                  ? 'var(--color-alert-500)'
                  : match.status === 'verified' || match.status === 'completed'
                    ? 'var(--color-pitch-400)'
                    : 'var(--line-strong)',
            }}
          >
            {MATCH_STATUS_LABEL[match.status as MatchStatus]}
          </div>
        </div>
        <PlayerZone name={nameOf(match.player_b)} team={match.team_b} align="end" />
      </section>

      {isParticipant ? (
        <EvidenceUploader
          matchId={matchId}
          tournamentId={match.tournament_id}
          alreadySubmitted={Boolean(myEvidence)}
          matchLocked={['verified', 'completed', 'cancelled'].includes(match.status)}
        />
      ) : null}

      {/* Public evidence */}
      <section className="strip" style={{ marginBlockStart: 32 }}>
        <h2 style={{ fontSize: 20, marginBlockEnd: 14 }}>الأدلة</h2>
        {activeEvidence.length === 0 ? (
          <div className="panel" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
            لم يُرفع أي توثيق بعد.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            }}
          >
            {activeEvidence.map((item) => {
              const extraction = extractionFor(item.id);
              return (
                <figure key={item.id} className="panel" style={{ margin: 0, padding: 12 }}>
                  <figcaption
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 13,
                      marginBlockEnd: 10,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>توثيق {nameOf(item.uploaded_by)}</span>
                    <time dateTime={item.created_at} className="numeric" style={{ color: 'var(--text-muted)' }}>
                      {new Date(item.created_at).toLocaleString('ar', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </figcaption>
                  <a href={publicUrl(item.storage_path)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={publicUrl(item.storage_path)}
                      alt={`صورة نتيجة أرسلها ${nameOf(item.uploaded_by)}`}
                      loading="lazy"
                      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 2 }}
                    />
                  </a>
                  {extraction ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBlockStart: 10 }}>
                      قراءة الذكاء الاصطناعي: {extraction.score_a} – {extraction.score_b}
                      {extraction.confidence_overall !== null
                        ? ` · ثقة ${Math.round(Number(extraction.confidence_overall) * 100)}%`
                        : ''}
                      {extraction.valid_result_screen === false ? ' · شاشة غير صالحة' : ''}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBlockStart: 10 }}>
                      الصورة قيد التحليل…
                    </div>
                  )}
                </figure>
              );
            })}
          </div>
        )}
      </section>

      {/* AI analysis */}
      {mergedStats && Object.keys(mergedStats).length > 0 ? (
        <section className="strip" style={{ marginBlockStart: 32 }}>
          <h2 style={{ fontSize: 20, marginBlockEnd: 14 }}>تحليل المباراة</h2>
          <StatRails
            statistics={mergedStats}
            nameA={nameOf(match.player_a)}
            nameB={nameOf(match.player_b)}
          />
        </section>
      ) : null}

      {/* Official decision history */}
      {decisions && decisions.length > 0 ? (
        <section className="strip" style={{ marginBlockStart: 32 }}>
          <h2 style={{ fontSize: 20, marginBlockEnd: 14 }}>سجل القرارات</h2>
          <ul className="panel" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {decisions.map((c) => (
              <li key={c.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {c.status === 'open' ? 'قضية مفتوحة' : 'قضية محسومة'} — {c.reason}
                </div>
                {c.resolution ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    القرار: {c.resolution}
                    {c.resolution_reason ? ` — ${c.resolution_reason}` : ''}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {news && news.length > 0 ? (
        <section className="strip" style={{ marginBlockStart: 32 }}>
          <h2 style={{ fontSize: 20, marginBlockEnd: 14 }}>أخبار متعلقة</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {news.map((n) => (
              <li key={n.id} className="panel" style={{ padding: '12px 16px' }}>
                <Link href={`/tournaments/${tournament.slug}?tab=news`}>{n.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PlayerZone({
  name,
  team,
  align,
}: {
  name: string;
  team: string | null;
  align: 'start' | 'end';
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div
        style={{
          fontSize: 'clamp(1rem, 3vw, 1.35rem)',
          fontWeight: 700,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
      {team ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 4 }}>{team}</div>
      ) : null}
    </div>
  );
}
