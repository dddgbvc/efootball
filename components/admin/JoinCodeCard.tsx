'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The code an organiser reads out.
 *
 * This replaces the "public tournament link" that used to sit here. That link
 * pointed at a page a draft tournament refuses to everyone but its organiser,
 * so sharing it handed the other person a 404 and no way to act on it. A code
 * cannot fail that way: it is either right or the lookup says so.
 */
export function JoinCodeCard({
  tournamentId,
  code,
  accepting,
  pendingRequests,
}: {
  tournamentId: string;
  code: string | null;
  accepting: boolean;
  pendingRequests: number;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(code);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('تعذر النسخ — انسخ الكود يدوياً.');
    }
  }

  async function rotate() {
    if (
      current &&
      !window.confirm('توليد كود جديد يُبطل الكود الحالي فوراً. هل تريد المتابعة؟')
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/join-code`, {
        method: 'POST',
      });
      const payload = (await response.json()) as {
        ok: boolean;
        joinCode?: string;
        message?: string;
      };
      if (!payload.ok || !payload.joinCode) {
        setError(payload.message ?? 'تعذر توليد كود جديد');
        return;
      }
      setCurrent(payload.joinCode);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel strip" style={{ padding: '16px 18px 20px' }}>
      <div className="eyebrow">كود الانضمام</div>

      {current ? (
        <div
          className="join-code"
          dir="ltr"
          aria-label={`كود الانضمام ${current.split('').join(' ')}`}
        >
          {current}
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBlock: '10px 0' }}>
          لا يوجد كود بعد.
        </p>
      )}

      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '10px 0 0' }}>
        {accepting
          ? 'أرسل هذا الكود للاعبين. يسجّلون دخولهم، يُدخلون الكود، فيصلك طلبهم هنا للموافقة.'
          : 'التسجيل غير مفتوح، فلن يستطيع أحد إرسال طلب بهذا الكود بعد. افتح التسجيل أولاً من «مراحل البطولة» أسفل الصفحة.'}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBlockStart: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 38 }}
          onClick={copy}
          disabled={!current}
        >
          {copied ? 'تم النسخ ✓' : 'نسخ الكود'}
        </button>
        <button
          type="button"
          className="btn"
          style={{ minHeight: 38 }}
          onClick={rotate}
          disabled={busy}
        >
          {busy ? '...' : current ? 'كود جديد' : 'توليد كود'}
        </button>
      </div>

      {pendingRequests > 0 ? (
        <a
          href={`/admin/tournaments/${tournamentId}/requests`}
          className="btn"
          style={{
            marginBlockStart: 12,
            width: '100%',
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
          }}
        >
          {pendingRequests} طلب انضمام بانتظار قرارك ←
        </a>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 13, marginBlockStart: 10 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
