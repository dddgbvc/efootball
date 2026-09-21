'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JoinRequestStatus } from '@/types/database';

export interface PendingRequestRow {
  id: string;
  status: JoinRequestStatus;
  createdAt: string;
  decisionNote: string | null;
  tournamentName: string;
}

const STATUS_LABEL: Record<JoinRequestStatus, string> = {
  pending: 'بانتظار قرار المنظّم',
  approved: 'مقبول — أنت داخل البطولة',
  rejected: 'مرفوض',
  cancelled: 'سحبتَ الطلب',
};

const STATUS_COLOR: Record<JoinRequestStatus, string> = {
  pending: 'var(--color-amber-signal)',
  approved: 'var(--color-pitch-400)',
  rejected: 'var(--color-alert-400)',
  cancelled: 'var(--text-muted)',
};

/**
 * The player's own side of the queue.
 *
 * A request that disappears after sending looks like a request that was never
 * sent, and the usual reaction is to send it again — which is why every state
 * is listed here, including the ones the player would rather not see. The
 * rejection note is shown when the organiser left one: "مرفوض" with no reason
 * is the kind of dead end that sends people to ask in a chat somewhere.
 */
export function PendingRequests({ rows }: { rows: PendingRequestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  async function withdraw(requestId: string) {
    if (!window.confirm('سحب الطلب؟ يمكنك إرساله مرة أخرى بنفس الكود.')) return;

    setBusy(requestId);
    setError(null);
    try {
      const response = await fetch('/api/player/join-request', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) {
        setError(payload.message ?? 'تعذر سحب الطلب');
        return;
      }
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={{ marginBlock: '18px 18px' }}>
      <div className="eyebrow" style={{ marginBlockEnd: 10 }}>
        طلباتك
      </div>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, margin: '0 0 10px' }}>
          {error}
        </p>
      ) : null}

      <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li key={row.id} className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 15 }} dir="auto">
                {row.tournamentName}
              </span>
              <time
                dateTime={row.createdAt}
                style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
              >
                {new Date(row.createdAt).toLocaleString('ar', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBlockStart: 8, flexWrap: 'wrap' }}>
              <span
                className="tag"
                style={{ borderColor: STATUS_COLOR[row.status], color: STATUS_COLOR[row.status] }}
              >
                {STATUS_LABEL[row.status]}
              </span>
              {row.status === 'pending' ? (
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 34, fontSize: 13 }}
                  disabled={busy !== null}
                  onClick={() => withdraw(row.id)}
                >
                  {busy === row.id ? '...' : 'سحب الطلب'}
                </button>
              ) : null}
            </div>

            {row.decisionNote ? (
              <p
                style={{
                  margin: '10px 0 0',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  borderInlineStart: '2px solid var(--line-strong)',
                  paddingInlineStart: 10,
                }}
                dir="auto"
              >
                {row.decisionNote}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
