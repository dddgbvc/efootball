'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CheckInButton({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%' }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch('/api/check-in', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tournamentId }),
            });
            const payload = (await response.json()) as { ok: boolean; message?: string };
            if (!payload.ok) setError(payload.message ?? 'تعذر تأكيد الحضور');
            else router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '...' : 'أنا حاضر'}
      </button>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 13, marginBlockEnd: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
