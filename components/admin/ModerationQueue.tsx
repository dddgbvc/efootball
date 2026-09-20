'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ModerationRow {
  id: string;
  target: string;
  targetId: string;
  reporter: string;
  reportedUser: string;
  hasReportedUser: boolean;
  reason: string;
  status: string;
  createdAt: string;
  actionTaken: string | null;
  content: string | null;
}

const TARGET_LABEL: Record<string, string> = {
  news_post: 'منشور',
  chat_message: 'رسالة',
  profile: 'ملف لاعب',
};

export function ModerationQueue({
  tournamentId,
  rows,
}: {
  tournamentId: string;
  rows: ModerationRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(reportId: string, action: string) {
    let note: string | null = null;
    if (action === 'warn' || action === 'mute') {
      note = window.prompt('ملاحظة تُرسل للاعب (اختياري):');
    }

    setBusy(`${reportId}:${action}`);
    setError(null);
    try {
      const response = await fetch('/api/moderation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reportId,
          tournamentId,
          action,
          note,
          muteMinutes: action === 'mute' ? 120 : null,
        }),
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
        لا توجد بلاغات.
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

      <ul style={{ display: 'grid', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li
            key={row.id}
            className="panel"
            style={{
              padding: '16px 18px',
              opacity: row.status === 'open' ? 1 : 0.6,
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="tag">{TARGET_LABEL[row.target] ?? row.target}</span>
              <span className="tag">{row.status === 'open' ? 'مفتوح' : row.actionTaken}</span>
              <time
                dateTime={row.createdAt}
                className="numeric"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
              >
                {new Date(row.createdAt).toLocaleString('ar')}
              </time>
            </div>

            <dl style={{ fontSize: 14, margin: '12px 0 0' }}>
              <Row term="المُبلِّغ" value={row.reporter} />
              {row.hasReportedUser ? <Row term="المُبلَّغ عنه" value={row.reportedUser} /> : null}
              <Row term="السبب" value={row.reason} />
              {row.content ? <Row term="المحتوى" value={row.content} /> : null}
            </dl>

            {row.status === 'open' ? (
              <div style={{ display: 'flex', gap: 8, marginBlockStart: 12, flexWrap: 'wrap' }}>
                {['ignore', 'delete_content', 'warn', 'mute'].map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={action === 'ignore' ? 'btn' : 'btn btn-danger'}
                    style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                    disabled={busy !== null || (action !== 'ignore' && action !== 'delete_content' && !row.hasReportedUser)}
                    onClick={() => act(row.id, action)}
                  >
                    {busy === `${row.id}:${action}`
                      ? '...'
                      : action === 'ignore'
                        ? 'تجاهل'
                        : action === 'delete_content'
                          ? 'حذف المحتوى'
                          : action === 'warn'
                            ? 'تنبيه'
                            : 'كتم'}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, paddingBlock: 3 }}>
      <dt style={{ color: 'var(--text-muted)' }}>{term}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
