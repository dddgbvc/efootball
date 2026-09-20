'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface AdminNewsPost {
  id: string;
  source: string;
  label: string;
  title: string | null;
  body: string;
  status: string;
  byline: string;
  matchId: string | null;
  createdAt: string;
  invalidationReason: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'مسودة',
  published: 'منشور',
  archived: 'مؤرشف',
  invalidated: 'ملغى',
};

export function NewsModeration({
  aiEnabled,
  aiMode,
  posts,
}: {
  aiEnabled: boolean;
  aiMode: string;
  posts: AdminNewsPost[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(postId: string, method: 'POST' | 'DELETE') {
    setBusy(postId);
    setError(null);
    try {
      const response = await fetch(`/api/news/${postId}/approve`, { method });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر تنفيذ الإجراء');
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="panel strip" style={{ padding: '16px 18px 18px' }}>
        <div className="eyebrow">إعدادات الأخبار</div>
        <div style={{ display: 'flex', gap: 8, marginBlockStart: 10, flexWrap: 'wrap' }}>
          <span className="tag">
            المراسل الآلي: {aiEnabled ? 'مفعّل' : 'معطّل'}
          </span>
          <span className="tag">
            وضع النشر: {aiMode === 'automatic' ? 'تلقائي' : 'مراجعة أولاً'}
          </span>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
          {error}
        </p>
      ) : null}

      {posts.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          لا توجد أخبار.
        </div>
      ) : (
        <ul style={{ display: 'grid', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
          {posts.map((post) => (
            <li key={post.id} className="panel" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="tag">{post.label}</span>
                <span
                  className="tag"
                  style={{
                    borderColor:
                      post.status === 'draft'
                        ? 'var(--color-amber-signal)'
                        : post.status === 'invalidated'
                          ? 'var(--color-alert-500)'
                          : undefined,
                  }}
                >
                  {STATUS_LABEL[post.status] ?? post.status}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{post.byline}</span>
              </div>

              {post.title ? (
                <h3 style={{ fontSize: 17, marginBlock: '10px 6px' }}>{post.title}</h3>
              ) : null}
              <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{post.body}</p>

              {post.invalidationReason ? (
                <p style={{ fontSize: 13, color: 'var(--color-alert-400)' }}>
                  {post.invalidationReason}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: 8, marginBlockStart: 12, flexWrap: 'wrap' }}>
                {post.matchId ? (
                  <Link
                    href={`/match/${post.matchId}`}
                    className="btn"
                    style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                  >
                    المباراة
                  </Link>
                ) : null}
                {post.status === 'draft' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                    disabled={busy === post.id}
                    onClick={() => act(post.id, 'POST')}
                  >
                    {busy === post.id ? '...' : 'اعتماد ونشر'}
                  </button>
                ) : null}
                {post.status !== 'archived' ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ minHeight: 32, padding: '0 10px', fontSize: 12 }}
                    disabled={busy === post.id}
                    onClick={() => act(post.id, 'DELETE')}
                  >
                    أرشفة
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
