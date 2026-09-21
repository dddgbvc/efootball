'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '@/lib/player/avatar';

/**
 * Upload, replace, remove.
 *
 * The checks here are for the person holding the phone — an instant "that file
 * is 9MB" beats a round trip. They are not the security boundary: the route
 * re-checks the size and sniffs the actual bytes, because everything a browser
 * reports about a file is a claim.
 */
export function AvatarUploader({
  initialPath,
  initialUrl,
  name,
}: {
  initialPath: string | null;
  initialUrl: string | null;
  name: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [hasImage, setHasImage] = useState(initialPath !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (!AVATAR_MIME_TYPES.includes(file.type as (typeof AVATAR_MIME_TYPES)[number])) {
      setError('الصيغ المقبولة: JPG أو PNG أو WebP.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError(`حجم الصورة أكبر من ${Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} ميجابايت.`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setBusy(true);

    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/player/avatar', { method: 'POST', body });
      const payload = (await response.json()) as {
        ok: boolean;
        url?: string;
        message?: string;
      };

      if (!payload.ok) {
        setError(payload.message ?? 'تعذر رفع الصورة.');
        setPreview(initialUrl);
        return;
      }

      // Cache-bust so the new face appears immediately rather than after the
      // CDN forgets the old one.
      setPreview(`${payload.url}?v=${Date.now()}`);
      setHasImage(true);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم.');
      setPreview(initialUrl);
    } finally {
      setBusy(false);
      URL.revokeObjectURL(objectUrl);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/player/avatar', { method: 'DELETE' });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) {
        setError(payload.message ?? 'تعذر حذف الصورة.');
        return;
      }
      setPreview(null);
      setHasImage(false);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 20 }}>
      <div className="avatar-editor">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="avatar avatar-lg" />
        ) : (
          <span aria-hidden className="avatar avatar-lg avatar-initials">
            {initials(name)}
          </span>
        )}

        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{name}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              style={{ minHeight: 38 }}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? '...' : hasImage ? 'تغيير الصورة' : 'رفع صورة'}
            </button>
            {hasImage ? (
              <button
                type="button"
                className="btn btn-danger"
                style={{ minHeight: 38 }}
                disabled={busy}
                onClick={remove}
              >
                حذف
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_MIME_TYPES.join(',')}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, margin: '12px 0 0' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2);
  return `${(parts[0] ?? '').charAt(0)}${(parts[1] ?? '').charAt(0)}`;
}
