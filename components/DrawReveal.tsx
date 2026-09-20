'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Pairing {
  position: number;
  playerA: string;
  playerB: string;
}

/**
 * The draw experience.
 *
 * The animation reveals a result the server already committed — sealed tiles
 * flip one pair at a time. No entropy, ordering or pairing is produced in the
 * browser; this component only plays back what the API returned.
 */
export function DrawReveal({
  tournamentId,
  kind,
  pot,
}: {
  tournamentId: string;
  kind: 'playoff' | 'semifinal';
  pot: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairings, setPairings] = useState<Pairing[] | null>(null);
  const [revealed, setRevealed] = useState(0);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/draw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        pairings?: Pairing[];
      };

      if (!payload.ok || !payload.pairings) {
        setError(payload.message ?? 'تعذر إجراء القرعة');
        return;
      }

      setPairings(payload.pairings);
      setRevealed(0);

      // Concise, staggered reveal; honours prefers-reduced-motion by resolving
      // immediately when the user asked for less motion.
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        setRevealed(payload.pairings.length);
      } else {
        payload.pairings.forEach((_, index) => {
          window.setTimeout(() => setRevealed(index + 1), 450 * (index + 1));
        });
        window.setTimeout(
          () => router.refresh(),
          450 * payload.pairings.length + 700,
        );
      }
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel strip" style={{ padding: '20px 22px 24px' }}>
      <div className="eyebrow" style={{ marginBlockEnd: 12 }}>
        {kind === 'playoff' ? 'قرعة التصفيات' : 'قرعة نصف النهائي'}
      </div>

      {pairings === null ? (
        <>
          {pot.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBlockEnd: 16 }}>
              {pot.map((name) => (
                <span key={name} className="tag">
                  {name}
                </span>
              ))}
            </div>
          ) : null}
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBlockStart: 0 }}>
            تُجرى القرعة على الخادم وتُحفظ نهائياً قبل عرضها. لا يمكن إعادتها.
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>
            {busy ? 'جارٍ إجراء القرعة...' : 'إجراء القرعة'}
          </button>
        </>
      ) : (
        <ol
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {pairings.map((pair, index) => {
            const open = index < revealed;
            return (
              <li
                key={pair.position}
                className={open ? 'animate-rise' : undefined}
                style={{
                  padding: '18px 16px',
                  border: `1px solid ${open ? 'var(--accent)' : 'var(--line-strong)'}`,
                  background: open ? 'var(--surface-raised)' : 'var(--surface-panel)',
                  textAlign: 'center',
                  minHeight: 88,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {open ? (
                  <div>
                    <div style={{ fontWeight: 800 }}>{pair.playerA}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>
                      ×
                    </div>
                    <div style={{ fontWeight: 800 }}>{pair.playerB}</div>
                  </div>
                ) : (
                  <span className="numeric" style={{ fontSize: 26, opacity: 0.4 }}>
                    {String(pair.position).padStart(2, '0')}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
