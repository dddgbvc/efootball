'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface RosterRow {
  id: string;
  userId: string;
  displayName: string;
  efootballName: string | null;
  platform: string | null;
  status: string;
  joinedAt: string;
  checkedInAt: string | null;
  removalReason: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  registered: 'مسجّل',
  approved: 'معتمد',
  checked_in: 'حاضر',
  no_show: 'لم يحضر',
  withdrawn: 'منسحب',
  rejected: 'مرفوض',
  disqualified: 'مستبعد',
};

export function RosterTable({
  tournamentId,
  rows,
}: {
  tournamentId: string;
  rows: RosterRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(playerId: string, action: string) {
    // Removing or disqualifying a player is consequential and audited, so the
    // reason is collected before anything is sent.
    let reason: string | null = null;
    if (action === 'remove' || action === 'disqualify') {
      reason = window.prompt('سبب القرار (مطلوب):');
      if (!reason || reason.trim().length < 5) return;
    }

    setBusy(`${playerId}:${action}`);
    setError(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/players`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, action, reason }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر تنفيذ الإجراء');
      else router.refresh();
    } finally {
      setBusy(null);
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
    <div>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              {['#', 'اللاعب', 'الاسم في اللعبة', 'الحالة', 'الحضور', 'إجراءات'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  style={{
                    textAlign: 'start',
                    padding: '10px 12px',
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--line)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td style={cell}>{index + 1}</td>
                <td style={cell}>
                  <strong>{row.displayName}</strong>
                  {row.removalReason ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {row.removalReason}
                    </div>
                  ) : null}
                </td>
                <td style={cell}>{row.efootballName ?? '—'}</td>
                <td style={cell}>
                  <span className="tag">{STATUS_LABEL[row.status] ?? row.status}</span>
                </td>
                <td style={cell}>{row.checkedInAt ? '✓' : '—'}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {row.status === 'registered' ? (
                      <ActionButton
                        label="اعتماد"
                        busy={busy === `${row.userId}:approve`}
                        onClick={() => act(row.userId, 'approve')}
                      />
                    ) : null}
                    {['registered', 'approved', 'checked_in'].includes(row.status) ? (
                      <>
                        <ActionButton
                          label="إزالة"
                          danger
                          busy={busy === `${row.userId}:remove`}
                          onClick={() => act(row.userId, 'remove')}
                        />
                        <ActionButton
                          label="استبعاد"
                          danger
                          busy={busy === `${row.userId}:disqualify`}
                          onClick={() => act(row.userId, 'disqualify')}
                        />
                      </>
                    ) : (
                      <ActionButton
                        label="إعادة"
                        busy={busy === `${row.userId}:reinstate`}
                        onClick={() => act(row.userId, 'reinstate')}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--line)',
  verticalAlign: 'top',
};

function ActionButton({
  label,
  onClick,
  busy,
  danger,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={danger ? 'btn btn-danger' : 'btn'}
      style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? '...' : label}
    </button>
  );
}
