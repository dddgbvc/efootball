'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TelegramLink({
  linked,
  username,
}: {
  linked: boolean;
  username: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (linked) {
    return (
      <div className="panel" style={{ padding: 18 }}>
        <p style={{ marginBlockStart: 0 }}>
          ✅ حسابك مرتبط{username ? ` بـ @${username}` : ''}. ستصلك تنبيهات البطولات على Telegram.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await fetch('/api/telegram/link', { method: 'DELETE' });
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          فصل الربط
        </button>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: 18 }}>
      <p style={{ marginBlockStart: 0, fontSize: 14, color: 'var(--text-muted)' }}>
        اربط حسابك لاستقبال تنبيهات التوثيق والنزاعات مباشرة على Telegram.
      </p>

      {deepLink ? (
        <a href={deepLink} target="_blank" rel="noreferrer" className="btn btn-primary">
          افتح البوت لإكمال الربط
        </a>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch('/api/telegram/link', { method: 'POST' });
              const payload = (await response.json()) as {
                ok: boolean;
                deepLink?: string;
                message?: string;
              };
              if (!payload.ok) setError(payload.message ?? 'تعذر إنشاء رابط الربط');
              else setDeepLink(payload.deepLink ?? null);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '...' : 'ربط Telegram'}
        </button>
      )}

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
