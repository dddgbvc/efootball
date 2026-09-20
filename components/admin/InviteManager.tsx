'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface InviteView {
  id: string;
  label: string | null;
  code: string;
  url: string;
  qrSvg: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  autoApprove: boolean;
}

export function InviteManager({
  tournamentId,
  invites,
}: {
  tournamentId: string;
  invites: InviteView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || null,
          maxUses: maxUses ? Number(maxUses) : null,
          autoApprove: true,
        }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر إنشاء الدعوة');
      else {
        setLabel('');
        setMaxUses('');
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function revoke(inviteId: string) {
    if (!window.confirm('إلغاء هذه الدعوة نهائياً؟')) return;
    setBusy(inviteId);
    try {
      await fetch(`/api/tournaments/${tournamentId}/invites/${inviteId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('تعذر النسخ — انسخ يدوياً.');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section className="panel strip" style={{ padding: '18px 20px 22px' }}>
        <div className="eyebrow" style={{ marginBlockEnd: 12 }}>
          دعوة جديدة
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <input
            className="field"
            placeholder="اسم الدعوة (اختياري)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
          />
          <input
            className="field"
            type="number"
            min={1}
            max={64}
            placeholder="أقصى عدد استخدامات"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={create}
          >
            {busy === 'create' ? '...' : 'إنشاء دعوة'}
          </button>
        </div>
        {error ? (
          <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
            {error}
          </p>
        ) : null}
      </section>

      {invites.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          لا توجد دعوات.
        </div>
      ) : (
        <ul
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {invites.map((invite) => {
            const dead =
              invite.revokedAt !== null ||
              (invite.maxUses !== null && invite.usedCount >= invite.maxUses);

            return (
              <li
                key={invite.id}
                className="panel"
                style={{ padding: 16, opacity: dead ? 0.55 : 1 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{invite.label ?? 'دعوة'}</strong>
                  <span className="tag numeric">
                    {invite.usedCount}
                    {invite.maxUses !== null ? ` / ${invite.maxUses}` : ''}
                  </span>
                </div>

                <div
                  className="numeric"
                  dir="ltr"
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    marginBlock: '12px 6px',
                  }}
                >
                  {invite.code}
                </div>

                <div
                  dir="ltr"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    wordBreak: 'break-all',
                    marginBlockEnd: 12,
                  }}
                >
                  {invite.url}
                </div>

                <div
                  aria-hidden
                  style={{ width: 120, marginBlockEnd: 12 }}
                  dangerouslySetInnerHTML={{ __html: invite.qrSvg }}
                />

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <SmallButton
                    label={copied === `${invite.id}:url` ? 'تم النسخ ✓' : 'نسخ الرابط'}
                    onClick={() => copy(invite.url, `${invite.id}:url`)}
                  />
                  <SmallButton
                    label={copied === `${invite.id}:code` ? 'تم النسخ ✓' : 'نسخ الرمز'}
                    onClick={() => copy(invite.code, `${invite.id}:code`)}
                  />
                  <a
                    className="btn"
                    style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                    download={`invite-${invite.code}.svg`}
                    href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(invite.qrSvg)}`}
                  >
                    تنزيل QR
                  </a>
                  {!invite.revokedAt ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                      disabled={busy === invite.id}
                      onClick={() => revoke(invite.id)}
                    >
                      {busy === invite.id ? '...' : 'إلغاء'}
                    </button>
                  ) : (
                    <span className="tag">ملغاة</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn"
      style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
