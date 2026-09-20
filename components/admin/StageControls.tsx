'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { nextStatuses, STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';

/**
 * Stage and engine controls.
 *
 * Every button is a request the server may refuse: the client shows what is
 * plausible, the server and the database decide what is legal.
 */
export function StageControls({
  tournamentId,
  status,
  playerCount,
  capacity,
  leagueGenerated,
  leagueComplete,
}: {
  tournamentId: string;
  status: TournamentStatus;
  playerCount: number;
  capacity: number;
  leagueGenerated: boolean;
  leagueComplete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(key: string, url: string, body?: unknown) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر تنفيذ الإجراء');
      else {
        setMessage('تم.');
        router.refresh();
      }
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(null);
    }
  }

  const transitions = nextStatuses(status).filter((s) => s !== 'cancelled' && s !== 'draft');

  return (
    <section className="panel strip" style={{ padding: '18px 20px 22px' }}>
      <div className="eyebrow" style={{ marginBlockEnd: 14 }}>
        إدارة المراحل
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {transitions.map((target) => (
          <button
            key={target}
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => call(target, `/api/tournaments/${tournamentId}/status`, { to: target })}
          >
            {busy === target ? '...' : `→ ${STATUS_LABELS_AR[target]}`}
          </button>
        ))}

        {!leagueGenerated && playerCount === capacity ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => call('league', `/api/tournaments/${tournamentId}/league`)}
          >
            {busy === 'league' ? '...' : 'توليد جدول الدوري'}
          </button>
        ) : null}

        {leagueComplete ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => call('playoff', `/api/tournaments/${tournamentId}/draw`, { kind: 'playoff' })}
          >
            {busy === 'playoff' ? '...' : 'إجراء قرعة التصفيات'}
          </button>
        ) : null}

        {status === 'playoffs' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() =>
              call('semifinal', `/api/tournaments/${tournamentId}/draw`, { kind: 'semifinal' })
            }
          >
            {busy === 'semifinal' ? '...' : 'إجراء قرعة نصف النهائي'}
          </button>
        ) : null}
      </div>

      {message ? (
        <p role="status" style={{ color: 'var(--accent)', fontSize: 14, marginBlockEnd: 0 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, marginBlockEnd: 0 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
