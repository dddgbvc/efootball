'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PlayerStatusRow {
  userId: string;
  displayName: string;
  publicStatus: string | null;
  publicNote: string | null;
  privateNote: string | null;
  statusUpdatedAt: string | null;
  rulesState: 'accepted' | 'declined' | 'pending';
  joinState: string | null;
  played: number;
  points: number;
}

const RULES_LABEL: Record<PlayerStatusRow['rulesState'], string> = {
  accepted: 'وافق',
  declined: 'لم يوافق',
  pending: 'لم يقرر بعد',
};

/**
 * The organiser's control over what a player sees about themselves.
 *
 * Two notes, kept visibly apart: the one the player reads, and the one only
 * organisers read. They are stored in different tables for the same reason
 * they are drawn in different boxes.
 */
export function PlayerStatusEditor({
  tournamentId,
  rows,
}: {
  tournamentId: string;
  rows: PlayerStatusRow[];
}) {
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [privateNote, setPrivateNote] = useState('');

  function open(row: PlayerStatusRow) {
    setOpenFor(row.userId);
    setStatus(row.publicStatus ?? '');
    setNote(row.publicNote ?? '');
    setPrivateNote(row.privateNote ?? '');
    setError(null);
  }

  async function save(userId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/player-status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          status: status.trim() === '' ? null : status.trim(),
          note: note.trim() === '' ? null : note.trim(),
          privateNote: privateNote.trim() === '' ? null : privateNote.trim(),
        }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) {
        setError(payload.message ?? 'تعذر الحفظ');
        return;
      }
      setOpenFor(null);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        لا يوجد مشاركون بعد.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}

      {rows.map((row) => (
        <div key={row.userId} className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ fontSize: 16 }}>{row.displayName}</strong>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span
                className="tag"
                style={
                  row.rulesState === 'declined'
                    ? { borderColor: 'var(--color-alert-500)', color: 'var(--color-alert-400)' }
                    : undefined
                }
              >
                القوانين: {RULES_LABEL[row.rulesState]}
              </span>
              {row.joinState ? <span className="tag">{row.joinState}</span> : null}
              <span className="tag numeric">
                {row.played} مباراة · {row.points} نقطة
              </span>
            </div>
          </div>

          <div style={{ marginBlockStart: 10, fontSize: 14 }}>
            <span style={{ color: 'var(--text-muted)' }}>الحالة المعروضة للاعب: </span>
            {row.publicStatus ? (
              <strong>{row.publicStatus}</strong>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>لم تُحدد</span>
            )}
          </div>
          {row.publicNote ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 4 }}>
              ملاحظة للاعب: {row.publicNote}
            </div>
          ) : null}
          {row.privateNote ? (
            <div
              style={{
                fontSize: 13,
                marginBlockStart: 8,
                padding: '8px 10px',
                border: '1px dashed var(--line-strong)',
                borderRadius: 3,
                color: 'var(--color-amber-signal)',
              }}
            >
              ملاحظة داخلية (لا يراها اللاعب): {row.privateNote}
            </div>
          ) : null}

          {openFor === row.userId ? (
            <div style={{ display: 'grid', gap: 10, marginBlockStart: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  الحالة (يراها اللاعب)
                </span>
                <input
                  className="field"
                  value={status}
                  maxLength={60}
                  onChange={(e) => setStatus(e.target.value)}
                  placeholder="مثال: جاهز للمباراة"
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  ملاحظة للاعب (اختيارية)
                </span>
                <textarea
                  className="field"
                  rows={2}
                  maxLength={400}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--color-amber-signal)' }}>
                  ملاحظة داخلية — لا تظهر للاعب أبداً
                </span>
                <textarea
                  className="field"
                  rows={2}
                  maxLength={2000}
                  value={privateNote}
                  onChange={(e) => setPrivateNote(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => save(row.userId)}
                >
                  {busy ? '...' : 'حفظ'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setOpenFor(null)}
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn"
              style={{ minHeight: 36, marginBlockStart: 12 }}
              onClick={() => open(row)}
            >
              تعديل حالة اللاعب
            </button>
          )}

          {row.statusUpdatedAt ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBlockStart: 8 }}>
              آخر تحديث: {new Date(row.statusUpdatedAt).toLocaleString('ar')}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
