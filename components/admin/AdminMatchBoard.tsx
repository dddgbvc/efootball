'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface AdminMatchRow {
  id: string;
  stage: string;
  roundNumber: number | null;
  leg: number;
  isKnockout: boolean;
  playerA: string;
  playerB: string;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  officialSource: string;
  note: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  league: 'الدوري',
  playoff: 'التصفيات',
  semifinal: 'نصف النهائي',
  third_place: 'المركز الثالث',
  final: 'النهائي',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'لم تبدأ',
  ready: 'جاهزة',
  live: 'جارية',
  awaiting_first_evidence: 'بانتظار التوثيق',
  awaiting_second_evidence: 'بانتظار الطرف الثاني',
  ai_verifying: 'تحقق آلي',
  awaiting_verification: 'بانتظار التحقق',
  review_required: 'تحتاج مراجعة',
  verified: 'موثقة',
  completed: 'منتهية',
  cancelled: 'ملغاة',
};

/**
 * Admin result console.
 *
 * Overriding a result always requires a written reason — the API rejects the
 * request without one, and the reason is what lands in the audit log next to
 * the previous and final scores.
 */
export function AdminMatchBoard({ rows }: { rows: AdminMatchRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ a: '', b: '', pa: '', pb: '', reason: '' });

  if (rows.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        لم يتم توليد أي مباريات بعد.
      </div>
    );
  }

  async function submit(row: AdminMatchRow) {
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/matches/${row.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matchId: row.id,
          scoreA: Number(form.a),
          scoreB: Number(form.b),
          penaltiesA: row.isKnockout && form.pa !== '' ? Number(form.pa) : null,
          penaltiesB: row.isKnockout && form.pb !== '' ? Number(form.pb) : null,
          reason: form.reason.trim(),
        }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر اعتماد النتيجة');
      else {
        setEditing(null);
        setForm({ a: '', b: '', pa: '', pb: '', reason: '' });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function retry(matchId: string) {
    setBusy(matchId);
    setError(null);
    try {
      const response = await fetch(`/api/matches/${matchId}/verify`, { method: 'POST' });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر إعادة التحقق');
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}

      <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li key={row.id} className="panel" style={{ padding: '14px 16px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {STAGE_LABEL[row.stage] ?? row.stage}
                  {row.roundNumber ? ` · ج${row.roundNumber}` : ''}
                  {row.isKnockout ? ` · ${row.leg === 1 ? 'ذهاب' : 'إياب'}` : ''}
                </div>
                <strong>
                  {row.playerA} × {row.playerB}
                </strong>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="score-figure" style={{ fontSize: 18 }}>
                  {row.scoreA ?? '–'} : {row.scoreB ?? '–'}
                </span>
                <span
                  className="tag"
                  style={{
                    borderColor:
                      row.status === 'review_required' ? 'var(--color-alert-500)' : undefined,
                  }}
                >
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                {row.officialSource === 'admin_override' ? (
                  <span className="tag">قرار إداري</span>
                ) : null}
                <Link
                  href={`/match/${row.id}`}
                  className="btn"
                  style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                >
                  الأدلة
                </Link>
                {['ai_verifying', 'awaiting_verification', 'review_required'].includes(
                  row.status,
                ) ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                    disabled={busy === row.id}
                    onClick={() => retry(row.id)}
                  >
                    {busy === row.id ? '...' : 'إعادة التحقق'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                  onClick={() => {
                    setEditing(editing === row.id ? null : row.id);
                    setForm({
                      a: row.scoreA?.toString() ?? '',
                      b: row.scoreB?.toString() ?? '',
                      pa: '',
                      pb: '',
                      reason: '',
                    });
                  }}
                >
                  {editing === row.id ? 'إغلاق' : 'اعتماد نتيجة'}
                </button>
              </div>
            </div>

            {row.note ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBlockStart: 6 }}>
                {row.note}
              </div>
            ) : null}

            {editing === row.id ? (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                  marginBlockStart: 12,
                  paddingBlockStart: 12,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <input
                  className="field"
                  type="number"
                  min={0}
                  max={99}
                  placeholder={row.playerA}
                  value={form.a}
                  onChange={(e) => setForm({ ...form, a: e.target.value })}
                />
                <input
                  className="field"
                  type="number"
                  min={0}
                  max={99}
                  placeholder={row.playerB}
                  value={form.b}
                  onChange={(e) => setForm({ ...form, b: e.target.value })}
                />
                {row.isKnockout && row.leg === 2 ? (
                  <>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={99}
                      placeholder="ترجيح أ"
                      value={form.pa}
                      onChange={(e) => setForm({ ...form, pa: e.target.value })}
                    />
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={99}
                      placeholder="ترجيح ب"
                      value={form.pb}
                      onChange={(e) => setForm({ ...form, pb: e.target.value })}
                    />
                  </>
                ) : null}
                <input
                  className="field"
                  style={{ gridColumn: '1 / -1' }}
                  placeholder="سبب القرار (مطلوب)"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  minLength={5}
                  maxLength={500}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ gridColumn: '1 / -1' }}
                  disabled={
                    busy === row.id ||
                    form.a === '' ||
                    form.b === '' ||
                    form.reason.trim().length < 5
                  }
                  onClick={() => submit(row)}
                >
                  {busy === row.id ? '...' : 'اعتماد النتيجة رسمياً'}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
