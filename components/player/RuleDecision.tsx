'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Accept or decline, and nothing in between.
 *
 * The version travels with the decision so a player cannot accept a document
 * that has since been rewritten — the server checks it against the version in
 * force and refuses a stale one.
 */
export function RuleDecision({
  tournamentId,
  rulesVersion,
  alreadyAccepted,
}: {
  tournamentId: string;
  rulesVersion: number;
  alreadyAccepted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accepted: boolean) {
    setError(null);
    setBusy(accepted ? 'accept' : 'decline');
    try {
      const response = await fetch('/api/player/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId, rulesVersion, accepted }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) {
        setError(payload.message ?? 'تعذر حفظ قرارك');
        return;
      }
      router.replace(accepted ? '/player' : '/player/rules');
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(null);
    }
  }

  if (alreadyAccepted) {
    return (
      <p
        role="status"
        style={{ marginBlockStart: 20, fontSize: 14, color: 'var(--color-pitch-400)' }}
      >
        ✓ وافقت على النسخة الحالية من القوانين.
      </p>
    );
  }

  return (
    <div style={{ marginBlockStart: 22 }}>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => decide(true)}
        >
          {busy === 'accept' ? '...' : 'أوافق على قوانين البطولة'}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => decide(false)}
        >
          {busy === 'decline' ? '...' : 'لا أوافق'}
        </button>
      </div>
    </div>
  );
}
