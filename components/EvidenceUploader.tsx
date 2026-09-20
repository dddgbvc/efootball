'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 10 * 1024 * 1024;

type Allowed = (typeof ALLOWED)[number];

/**
 * Two-step submission: the file goes straight to Storage under a path the
 * policy pins to this player and this match, then the server verifies the
 * object exists and re-hashes its bytes before recording it.
 *
 * Once recorded the evidence is immutable — a mistake goes through
 * "طلب تصحيح التوثيق", never a silent replacement.
 */
export function EvidenceUploader({
  matchId,
  tournamentId,
  alreadySubmitted,
  matchLocked,
}: {
  matchId: string;
  tournamentId: string;
  alreadySubmitted: boolean;
  matchLocked: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');

  if (matchLocked) {
    return (
      <div className="panel" style={{ padding: 18, color: 'var(--text-muted)' }}>
        تم اعتماد نتيجة هذه المباراة رسمياً.
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <div className="panel strip" style={{ padding: '18px 20px 20px' }}>
        <p style={{ marginBlockStart: 0 }}>
          ✅ تم استلام توثيقك. لا يمكن تعديله أو حذفه — إن كان هناك خطأ، اطلب تصحيح التوثيق.
        </p>

        {correctionOpen ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <textarea
              className="field"
              rows={3}
              placeholder="اشرح سبب طلب التصحيح"
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              minLength={5}
              maxLength={500}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || correctionReason.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await fetch(`/api/matches/${matchId}/correction`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ matchId, reason: correctionReason.trim() }),
                    });
                    const body = (await res.json()) as { ok: boolean; message?: string };
                    if (!body.ok) setError(body.message ?? 'تعذر إرسال الطلب');
                    else {
                      setStatus('تم إرسال الطلب إلى المسؤول.');
                      setCorrectionOpen(false);
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                إرسال الطلب
              </button>
              <button type="button" className="btn" onClick={() => setCorrectionOpen(false)}>
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setCorrectionOpen(true)}>
            طلب تصحيح التوثيق
          </button>
        )}

        {status ? <p style={{ color: 'var(--accent)', fontSize: 14 }}>{status}</p> : null}
        {error ? (
          <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setError(null);

    if (!ALLOWED.includes(file.type as Allowed)) {
      setError('الصيغة غير مدعومة. استخدم JPEG أو PNG أو WEBP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('حجم الصورة يتجاوز 10 ميجابايت.');
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('انتهت الجلسة. سجّل الدخول مجدداً.');
        return;
      }

      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const fileHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${tournamentId}/${matchId}/${user.id}/${fileHash.slice(0, 16)}.${extension}`;

      setStatus('جارٍ رفع الصورة...');
      const { error: uploadError } = await supabase.storage
        .from('match-evidence')
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError && !/already exists/i.test(uploadError.message)) {
        setError(`تعذر رفع الصورة: ${uploadError.message}`);
        return;
      }

      setStatus('جارٍ التحقق...');
      const response = await fetch(`/api/matches/${matchId}/evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matchId,
          storagePath: path,
          fileHash,
          mimeType: file.type,
          byteSize: file.size,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        state?: string;
        message?: string;
      };

      if (!payload.ok) {
        setError(payload.message ?? 'تعذر تسجيل التوثيق');
        return;
      }

      setStatus(
        payload.state === 'awaiting_second_evidence'
          ? 'تم الاستلام. بانتظار الطرف الثاني.'
          : payload.state === 'verified'
            ? 'تم توثيق النتيجة بنجاح.'
            : payload.state === 'review_required'
              ? 'هناك اختلاف — القضية الآن لدى المسؤول.'
              : 'تم الاستلام.',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ غير متوقع');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel strip" style={{ padding: '18px 20px 22px' }}>
      <h2 style={{ fontSize: 17, marginBlockEnd: 6 }}>توثيق النتيجة</h2>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBlockStart: 0 }}>
        ارفع صورة شاشة النتيجة/الإحصائيات من اللعبة. لا يمكن تعديل الصورة بعد إرسالها.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="field"
        disabled={busy}
      />

      {status ? (
        <p role="status" style={{ color: 'var(--accent)', fontSize: 14 }}>
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-primary"
        style={{ marginBlockStart: 12, width: '100%' }}
        disabled={busy}
        onClick={upload}
      >
        {busy ? 'جارٍ المعالجة...' : 'إرسال التوثيق'}
      </button>
    </div>
  );
}
