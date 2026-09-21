'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/player/Avatar';
import type { JoinRequestStatus } from '@/types/database';

export interface JoinRequestRow {
  id: string;
  userId: string;
  displayName: string;
  avatarPath: string | null;
  efootballName: string | null;
  platform: string | null;
  status: JoinRequestStatus;
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

const STATUS_LABEL: Record<JoinRequestStatus, string> = {
  pending: 'بانتظار قرارك',
  approved: 'مقبول',
  rejected: 'مرفوض',
  cancelled: 'سحب الطلب',
};

const ERROR_MESSAGE: Record<string, string> = {
  TOURNAMENT_FULL: 'اكتمل عدد المشاركين — لم يعد هناك مقعد.',
  REGISTRATION_CLOSED: 'التسجيل مغلق. افتحه من لوحة التحكم أولاً.',
  ALREADY_DECIDED: 'تم البتّ في هذا الطلب بالفعل.',
  ALREADY_JOINED: 'هذا اللاعب مشارك في البطولة أصلاً.',
  FORBIDDEN: 'ليست لديك صلاحية إدارة هذه البطولة.',
  REQUEST_NOT_FOUND: 'الطلب لم يعد موجوداً.',
};

/**
 * The approval queue.
 *
 * Accepting is the act that takes a seat, so the button is the one place in
 * the interface where the roster grows. Everything the organiser needs to
 * recognise the person — their name in the game, their platform — is on the
 * row, because "approve" is otherwise a decision about a string.
 */
export function JoinRequestQueue({
  tournamentId,
  rows,
  canDecide,
}: {
  tournamentId: string;
  rows: JoinRequestRow[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = rows.filter((r) => r.status === 'pending');
  const decided = rows.filter((r) => r.status !== 'pending');

  async function decide(requestId: string, action: 'approve' | 'reject') {
    let note: string | null = null;
    if (action === 'reject') {
      note = window.prompt('سبب الرفض (اختياري — يراه اللاعب):');
      if (note === null) return;
    }

    setBusy(requestId);
    setError(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, action, note: note || undefined }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
      };
      if (!payload.ok) {
        setError(ERROR_MESSAGE[payload.error ?? ''] ?? payload.message ?? 'تعذر تنفيذ القرار');
        return;
      }
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        لا توجد طلبات انضمام بعد. شارك كود البطولة مع اللاعبين ليصلك طلبهم هنا.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, margin: 0 }}>
          {error}
        </p>
      ) : null}

      <section>
        <div className="eyebrow" style={{ marginBlockEnd: 10 }}>
          بانتظار قرارك ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div className="panel" style={{ padding: 24, color: 'var(--text-muted)', fontSize: 14 }}>
            لا توجد طلبات معلّقة.
          </div>
        ) : (
          <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {pending.map((row) => (
              <li key={row.id} className="panel" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar path={row.avatarPath} name={row.displayName} size={44} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{row.displayName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }} dir="auto">
                      {[row.efootballName, row.platform].filter(Boolean).join(' · ') ||
                        'لم يكمل بياناته داخل اللعبة'}
                    </div>
                  </div>
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

                {row.message ? (
                  <p
                    style={{
                      margin: '10px 0 0',
                      fontSize: 14,
                      color: 'var(--text-muted)',
                      borderInlineStart: '2px solid var(--line-strong)',
                      paddingInlineStart: 10,
                    }}
                  >
                    {row.message}
                  </p>
                ) : null}

                <div style={{ display: 'flex', gap: 8, marginBlockStart: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ minHeight: 38 }}
                    disabled={busy !== null || !canDecide}
                    onClick={() => decide(row.id, 'approve')}
                  >
                    {busy === row.id ? '...' : 'قبول'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ minHeight: 38 }}
                    disabled={busy !== null}
                    onClick={() => decide(row.id, 'reject')}
                  >
                    رفض
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 ? (
        <section>
          <div className="eyebrow" style={{ marginBlockEnd: 10 }}>
            قرارات سابقة
          </div>
          <ul style={{ display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
            {decided.map((row) => (
              <li
                key={row.id}
                className="panel"
                style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <Avatar path={row.avatarPath} name={row.displayName} size={32} />
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{row.displayName}</span>
                <span
                  className="tag"
                  style={
                    row.status === 'approved'
                      ? { borderColor: 'var(--color-pitch-400)', color: 'var(--color-pitch-400)' }
                      : { borderColor: 'var(--line-strong)', color: 'var(--text-muted)' }
                  }
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
