'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * The join action.
 *
 * The button only ever calls the server; the displayed count is never the
 * authority. A losing race returns TOURNAMENT_FULL and the UI says so rather
 * than optimistically showing a seat that no longer exists.
 */
export function JoinPanel({
  tournamentId,
  tournamentSlug,
  inviteToken,
  signedIn,
}: {
  tournamentId: string;
  tournamentSlug: string;
  inviteToken: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    const next = `/join/${inviteToken}`;
    return (
      <div className="panel strip" style={{ padding: '20px 22px 24px' }}>
        <p style={{ marginBlockStart: 0 }}>
          سجّل الدخول أو أنشئ حساباً لإكمال الانضمام. سنعيدك إلى هذه الدعوة تلقائياً.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href={`/register?next=${encodeURIComponent(next)}`}
            className="btn btn-primary"
          >
            إنشاء حساب
          </Link>
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn">
            تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId, inviteToken }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };

      if (!payload.ok) {
        setError(payload.message ?? 'تعذر الانضمام');
        router.refresh();
        return;
      }

      router.push(`/tournaments/${tournamentSlug}`);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel strip" style={{ padding: '20px 22px 24px' }}>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          style={{ marginBlockStart: 4, width: 18, height: 18 }}
        />
        <span style={{ fontSize: 14 }}>
          أوافق على قوانين البطولة، وألتزم برفع صورة نتيجة كل مباراة من شاشة النتيجة.
        </span>
      </label>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-primary"
        style={{ marginBlockStart: 16, width: '100%' }}
        disabled={!accepted || busy}
        onClick={join}
      >
        {busy ? 'جارٍ الانضمام...' : 'انضم إلى البطولة'}
      </button>
    </div>
  );
}
