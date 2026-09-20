'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Initial {
  displayName: string;
  fullName: string;
  efootballName: string;
  efootballId: string;
  platform: string;
  phone: string;
  telegramUsername: string;
  bio: string;
  avatarPath: string | null;
}

const PLATFORMS = [
  ['', '—'],
  ['ps5', 'PlayStation 5'],
  ['ps4', 'PlayStation 4'],
  ['xbox', 'Xbox'],
  ['pc', 'PC'],
  ['mobile', 'موبايل'],
  ['other', 'أخرى'],
] as const;

function avatarUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/storage/v1/object/public/avatars/${path}`;
}

export function ProfileForm({ initial, userId }: { initial: Initial; userId: string }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Initial>(key: K, value: Initial[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Avatars are downscaled to a 512px square in the browser before upload, so
   * the original phone-camera file never becomes the image every standings row
   * has to load.
   */
  async function uploadAvatar(file: File) {
    setError(null);
    setBusy(true);
    try {
      const square = await toSquareWebp(file, 512);
      const supabase = createClient();
      const path = `${userId}/avatar-${Date.now()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, square, { contentType: 'image/webp', upsert: true });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      set('avatarPath', path);
      setStatus('تم رفع الصورة. اضغط حفظ لتثبيتها.');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName,
          fullName: form.fullName || null,
          efootballName: form.efootballName || null,
          efootballId: form.efootballId || null,
          platform: form.platform || null,
          phone: form.phone || null,
          telegramUsername: form.telegramUsername || null,
          bio: form.bio || null,
          avatarPath: form.avatarPath,
        }),
      });

      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر الحفظ');
      else {
        setStatus('تم الحفظ.');
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 2,
            border: '1px solid var(--line-strong)',
            overflow: 'hidden',
            background: 'var(--surface-raised)',
            flexShrink: 0,
          }}
        >
          {form.avatarPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl(form.avatarPath)}
              alt="صورتك"
              width={72}
              height={72}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            type="file"
            accept="image/*"
            className="field"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />
          {form.avatarPath ? (
            <button type="button" className="btn" onClick={() => set('avatarPath', null)}>
              إزالة الصورة
            </button>
          ) : null}
        </div>
      </div>

      <Field label="الاسم الظاهر" value={form.displayName} onChange={(v) => set('displayName', v)} required />
      <Field label="الاسم الكامل" value={form.fullName} onChange={(v) => set('fullName', v)} />
      <Field label="الاسم في eFootball" value={form.efootballName} onChange={(v) => set('efootballName', v)} />
      <Field label="معرّف eFootball" value={form.efootballId} onChange={(v) => set('efootballId', v)} />

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>المنصة</span>
        <select
          className="field"
          value={form.platform}
          onChange={(e) => set('platform', e.target.value)}
        >
          {PLATFORMS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <Field label="رقم الهاتف (اختياري)" value={form.phone} onChange={(v) => set('phone', v)} />
      <Field
        label="معرّف Telegram (اختياري)"
        value={form.telegramUsername}
        onChange={(v) => set('telegramUsername', v)}
      />

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>نبذة</span>
        <textarea
          className="field"
          rows={3}
          maxLength={400}
          value={form.bio}
          onChange={(e) => set('bio', e.target.value)}
        />
      </label>

      {status ? <p style={{ color: 'var(--accent)', fontSize: 14, margin: 0 }}>{status}</p> : null}
      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, margin: 0 }}>
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? '...' : 'حفظ'}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <input
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

/** Centre-crops to 1:1 and re-encodes as WebP. */
async function toSquareWebp(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      'image/webp',
      0.88,
    );
  });
}
