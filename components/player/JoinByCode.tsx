'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Found {
  ok: boolean;
  error?: string;
  tournament_id?: string;
  name?: string;
  status?: string;
  capacity?: number;
  player_count?: number;
  accepting?: boolean;
  already_member?: boolean;
  existing_request?: string | null;
}

const LOOKUP_ERROR: Record<string, string> = {
  CODE_MALFORMED: 'الكود مكوّن من ثمانية أحرف وأرقام.',
  CODE_NOT_FOUND: 'لا توجد بطولة بهذا الكود. تأكد منه مع منظّم البطولة.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
};

const SUBMIT_ERROR: Record<string, string> = {
  ALREADY_JOINED: 'أنت مشارك في هذه البطولة بالفعل.',
  REGISTRATION_CLOSED: 'التسجيل في هذه البطولة غير مفتوح حالياً.',
  RATE_LIMITED: 'أرسلت طلبات كثيرة. حاول لاحقاً.',
};

/**
 * Enter a code, see what it is, then ask to join.
 *
 * The preview step is the point: a player who types a code and is instantly
 * committed to a tournament they did not mean to join has no way back, and a
 * player shown "not found" when the code was right but registration is closed
 * will conclude they mistyped it. Both states are named.
 */
export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFound(null);
    setBusy(true);
    try {
      const response = await fetch('/api/player/join-request', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        result?: Found;
        error?: string;
        message?: string;
      };

      if (!payload.ok) {
        setError(LOOKUP_ERROR[payload.error ?? ''] ?? payload.message ?? 'تعذر البحث');
        return;
      }
      const result = payload.result;
      if (!result?.ok) {
        setError(LOOKUP_ERROR[result?.error ?? ''] ?? 'لا توجد بطولة بهذا الكود.');
        return;
      }
      setFound(result);
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/player/join-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, message: message.trim() || undefined }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
      };
      if (!payload.ok) {
        setError(SUBMIT_ERROR[payload.error ?? ''] ?? payload.message ?? 'تعذر إرسال الطلب');
        return;
      }
      setSent(true);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="panel" style={{ padding: 22 }}>
        <div className="eyebrow">تم الإرسال</div>
        <h2 style={{ fontSize: 19, marginBlock: '8px 8px' }}>وصل طلبك إلى منظّم البطولة</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
          ستصلك رسالة فور قبوله. لا حاجة لإرسال الطلب مرة أخرى.
        </p>
      </section>
    );
  }

  return (
    <section className="panel" style={{ padding: 20 }}>
      <form onSubmit={lookup} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>كود البطولة</span>
          <input
            className="field join-code-input"
            dir="ltr"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setFound(null);
            }}
            placeholder="ABCD-1234"
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </label>

        {!found ? (
          <button type="submit" className="btn btn-primary" disabled={busy || code.length < 8}>
            {busy ? '...' : 'ابحث عن البطولة'}
          </button>
        ) : null}
      </form>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, marginBlockStart: 12 }}>
          {error}
        </p>
      ) : null}

      {found ? (
        <div style={{ marginBlockStart: 16, borderTop: '1px solid var(--line)', paddingBlockStart: 16 }}>
          <div className="eyebrow">البطولة</div>
          <h2 style={{ fontSize: 20, marginBlock: '6px 10px' }}>{found.name}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="tag numeric">
              {found.player_count} / {found.capacity}
            </span>
            {!found.accepting ? (
              <span className="tag" style={{ borderColor: 'var(--color-amber-signal)', color: 'var(--color-amber-signal)' }}>
                التسجيل لم يُفتح بعد
              </span>
            ) : null}
          </div>

          {found.already_member ? (
            <p style={{ marginBlockStart: 14, fontSize: 14, color: 'var(--color-pitch-400)' }}>
              أنت مشارك في هذه البطولة بالفعل.
            </p>
          ) : found.existing_request === 'pending' ? (
            <p style={{ marginBlockStart: 14, fontSize: 14, color: 'var(--text-muted)' }}>
              لديك طلب معلّق على هذه البطولة بانتظار قرار المنظّم.
            </p>
          ) : !found.accepting ? (
            <p style={{ marginBlockStart: 14, fontSize: 14, color: 'var(--text-muted)' }}>
              الكود صحيح، لكن المنظّم لم يفتح التسجيل بعد. راجعه لاحقاً.
            </p>
          ) : (
            <>
              <label style={{ display: 'grid', gap: 6, marginBlockStart: 14 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  رسالة للمنظّم (اختيارية)
                </span>
                <textarea
                  className="field"
                  rows={2}
                  maxLength={300}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="مثال: اسمي داخل اللعبة كذا"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginBlockStart: 12, width: '100%' }}
                disabled={busy}
                onClick={send}
              >
                {busy ? '...' : 'أرسل طلب انضمام'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
