import { FLOW_RAIL_STAGES, flowRailIndex } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';

/**
 * Tournament Flow Rail — the product's signature component.
 *
 * Desktop: a spatial horizontal composition spanning the full content width.
 * Mobile: the same rail, scroll-snapped and swipeable, with the current stage
 * scrolled into view. The current stage is emphasised by inversion, not by a
 * glow, so it survives a flat rendering.
 */
export function TournamentFlowRail({
  status,
  leagueProgress,
}: {
  status: TournamentStatus;
  leagueProgress?: { verified: number; total: number };
}) {
  const current = flowRailIndex(status);

  return (
    <section aria-label="مسار البطولة" className="strip">
      <div className="eyebrow" style={{ marginBlockEnd: 10 }}>
        مسار البطولة
      </div>
      <ol className="flow-rail" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {FLOW_RAIL_STAGES.map((stage, index) => {
          const state =
            current < 0 ? 'upcoming' : index < current ? 'done' : index === current ? 'current' : 'upcoming';

          return (
            <li
              key={stage.key}
              className="flow-stage"
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <div
                className="numeric"
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  opacity: state === 'current' ? 0.7 : 0.45,
                  letterSpacing: '0.12em',
                }}
              >
                {String(index + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 15,
                  marginBlockStart: 2,
                }}
              >
                {stage.label}
              </div>
              {stage.key === 'league_active' && leagueProgress && leagueProgress.total > 0 ? (
                <div
                  className="numeric"
                  style={{ fontSize: 12, opacity: 0.7, marginBlockStart: 4 }}
                >
                  {leagueProgress.verified} / {leagueProgress.total}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
