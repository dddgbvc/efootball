import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { EmptyState } from './StandingsTable';
import type { MatchStatus } from '@/types/database';

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  pending: 'لم تبدأ',
  ready: 'جاهزة',
  live: 'جارية',
  awaiting_first_evidence: 'بانتظار التوثيق',
  awaiting_second_evidence: 'بانتظار الطرف الثاني',
  ai_verifying: 'جاري التحقق بالذكاء الاصطناعي',
  awaiting_verification: 'بانتظار التحقق',
  review_required: 'تحتاج مراجعة',
  verified: 'موثقة',
  completed: 'منتهية',
  cancelled: 'ملغاة',
};

const STATUS_COLOR: Partial<Record<MatchStatus, string>> = {
  review_required: 'var(--color-alert-500)',
  verified: 'var(--color-pitch-400)',
  completed: 'var(--color-pitch-400)',
  ai_verifying: 'var(--color-amber-signal)',
  awaiting_second_evidence: 'var(--color-amber-signal)',
};

const STAGE_LABEL: Record<string, string> = {
  league: 'الدوري',
  playoff: 'التصفيات',
  semifinal: 'نصف النهائي',
  third_place: 'المركز الثالث',
  final: 'النهائي',
};

export async function MatchList({
  tournamentId,
  currentUserId,
  limit,
}: {
  tournamentId: string;
  currentUserId: string | null;
  limit?: number;
}) {
  const supabase = await createServerSupabase();

  let query = supabase
    .from('matches')
    .select(
      'id, stage, round_number, leg, player_a, player_b, score_a, score_b, status, scheduled_at',
    )
    .eq('tournament_id', tournamentId)
    .order('stage', { ascending: true })
    .order('round_number', { ascending: true, nullsFirst: false })
    .order('leg', { ascending: true });

  if (limit) query = query.limit(limit);

  const { data: matches } = await query;

  if (!matches || matches.length === 0) {
    return <EmptyState>لا توجد مباريات بعد.</EmptyState>;
  }

  const ids = [...new Set(matches.flatMap((m) => [m.player_a, m.player_b]))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', ids);

  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? '—';

  return (
    <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
      {matches.map((match) => {
        const mine =
          currentUserId !== null &&
          (match.player_a === currentUserId || match.player_b === currentUserId);
        const hasScore = match.score_a !== null && match.score_b !== null;

        return (
          <li key={match.id}>
            <Link
              href={`/match/${match.id}`}
              className="panel"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderInlineStartWidth: mine ? 3 : 1,
                borderInlineStartColor: mine ? 'var(--accent)' : 'var(--line)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                  {STAGE_LABEL[match.stage] ?? match.stage}
                  {match.round_number ? ` · ج${match.round_number}` : ''}
                  {match.stage !== 'league' ? ` · ${match.leg === 1 ? 'ذهاب' : 'إياب'}` : ''}
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nameOf(match.player_a)}
                </div>
              </div>

              <div style={{ textAlign: 'center', minWidth: 76 }}>
                {hasScore ? (
                  <div className="score-figure" style={{ fontSize: 22 }}>
                    {match.score_a} – {match.score_b}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>×</div>
                )}
                <div
                  style={{
                    fontSize: 10,
                    marginBlockStart: 4,
                    color: STATUS_COLOR[match.status as MatchStatus] ?? 'var(--text-muted)',
                    fontWeight: 700,
                  }}
                >
                  {MATCH_STATUS_LABEL[match.status as MatchStatus]}
                </div>
              </div>

              <div style={{ minWidth: 0, textAlign: 'end' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>&nbsp;</div>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nameOf(match.player_b)}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
