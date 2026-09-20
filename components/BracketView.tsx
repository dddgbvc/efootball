import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { EmptyState } from './StandingsTable';

const STAGE_ORDER = ['playoff', 'semifinal', 'final'] as const;
const STAGE_LABEL: Record<string, string> = {
  playoff: 'التصفيات',
  semifinal: 'نصف النهائي',
  final: 'النهائي',
};

/**
 * Knockout bracket rendered from persisted ties, plus the official draw record.
 *
 * Nothing is computed client-side: the aggregate, the winner and the pairings
 * shown here are the values the engine wrote when the result became official.
 */
export async function BracketView({
  tournamentId,
  showDraw,
}: {
  tournamentId: string;
  showDraw: boolean;
}) {
  const supabase = await createServerSupabase();

  const [{ data: ties }, { data: draws }] = await Promise.all([
    supabase
      .from('knockout_ties')
      .select(
        'id, stage, position, label, player_a, player_b, aggregate_a, aggregate_b, penalties_a, penalties_b, winner_id, status',
      )
      .eq('tournament_id', tournamentId)
      .order('position', { ascending: true }),
    supabase
      .from('draws')
      .select('id, kind, seed_hash, executed_at, revealed_at')
      .eq('tournament_id', tournamentId),
  ]);

  if (!ties || ties.length === 0) {
    return (
      <EmptyState>
        لم تبدأ الأدوار الإقصائية بعد. تُجرى القرعة بعد اكتمال توثيق كل مباريات الدوري.
      </EmptyState>
    );
  }

  const ids = [
    ...new Set(ties.flatMap((t) => [t.player_a, t.player_b]).filter((v): v is string => !!v)),
  ];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', ids);

  const nameOf = (id: string | null) =>
    id ? (profiles?.find((p) => p.id === id)?.display_name ?? '—') : 'بانتظار المتأهل';

  return (
    <div style={{ display: 'grid', gap: 26 }}>
      {showDraw && draws && draws.length > 0 ? (
        <div className="panel" style={{ padding: 18 }}>
          <div className="eyebrow">سجل القرعة الرسمية</div>
          <ul style={{ margin: '10px 0 0', paddingInlineStart: 18, fontSize: 14 }}>
            {draws.map((d) => (
              <li key={d.id} style={{ marginBlockEnd: 6 }}>
                {STAGE_LABEL[d.kind] ?? d.kind} —{' '}
                <time dateTime={d.executed_at} className="numeric">
                  {new Date(d.executed_at).toLocaleString('ar')}
                </time>
                <div
                  dir="ltr"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                  }}
                >
                  {d.seed_hash}
                </div>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBlockEnd: 0 }}>
            البصمة أعلاه تثبت أن المواجهات المعروضة هي نفسها التي سُجلت لحظة إجراء القرعة على
            الخادم.
          </p>
        </div>
      ) : null}

      {STAGE_ORDER.map((stage) => {
        const stageTies = ties.filter((t) => t.stage === stage);
        if (stageTies.length === 0) return null;

        return (
          <section key={stage} className="strip">
            <h2 style={{ fontSize: 18, marginBlockEnd: 12 }}>{STAGE_LABEL[stage]}</h2>
            <ul
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                listStyle: 'none',
                margin: 0,
                padding: 0,
              }}
            >
              {stageTies.map((tie) => {
                const decided = tie.winner_id !== null;
                return (
                  <li key={tie.id} className="panel" style={{ padding: 16 }}>
                    <div className="eyebrow">{tie.label ?? `${STAGE_LABEL[stage]} ${tie.position}`}</div>
                    <TieSide
                      name={nameOf(tie.player_a)}
                      score={tie.aggregate_a}
                      winner={decided && tie.winner_id === tie.player_a}
                    />
                    <TieSide
                      name={nameOf(tie.player_b)}
                      score={tie.aggregate_b}
                      winner={decided && tie.winner_id === tie.player_b}
                    />
                    {tie.penalties_a !== null && tie.penalties_b !== null ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBlockStart: 6 }}>
                        ركلات الترجيح {tie.penalties_a} – {tie.penalties_b}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBlockStart: 6 }}>
                      المجموع {tie.aggregate_a} – {tie.aggregate_b}
                    </div>
                    <TieLegs tieId={tie.id} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TieSide({ name, score, winner }: { name: string; score: number; winner: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        paddingBlock: 8,
        borderBottom: '1px solid var(--line)',
        fontWeight: winner ? 800 : 500,
        color: winner ? 'var(--accent)' : 'inherit',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
      <span className="numeric">{score}</span>
    </div>
  );
}

async function TieLegs({ tieId }: { tieId: string }) {
  const supabase = await createServerSupabase();
  const { data: legs } = await supabase
    .from('matches')
    .select('id, leg, score_a, score_b, status')
    .eq('tie_id', tieId)
    .order('leg', { ascending: true });

  if (!legs || legs.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 8, marginBlockStart: 10, flexWrap: 'wrap' }}>
      {legs.map((leg) => (
        <Link key={leg.id} href={`/match/${leg.id}`} className="tag">
          {leg.leg === 1 ? 'ذهاب' : 'إياب'}
          {leg.score_a !== null ? ` ${leg.score_a}–${leg.score_b}` : ''}
        </Link>
      ))}
    </div>
  );
}
