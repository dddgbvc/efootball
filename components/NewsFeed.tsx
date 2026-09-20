import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { EmptyState } from './StandingsTable';
import type { NewsLabel } from '@/types/database';

const LABEL_AR: Record<NewsLabel, string> = {
  MATCH_REPORT: 'تقرير مباراة',
  BREAKING: 'عاجل',
  BIG_WIN: 'اكتساح',
  QUALIFIED: 'تأهل',
  DRAW: 'تعادل',
  PLAYOFF: 'التصفيات',
  FINAL: 'النهائي',
  CHAMPION: 'البطل',
  PLAYER_POST: 'منشور لاعب',
  STANDINGS: 'الترتيب',
};

const LABEL_COLOR: Partial<Record<NewsLabel, string>> = {
  BIG_WIN: 'var(--color-alert-500)',
  CHAMPION: 'var(--accent)',
  BREAKING: 'var(--color-amber-signal)',
  FINAL: 'var(--accent)',
};

/**
 * Editorial newsroom layout — a lead story plus a ruled column, not a social
 * timeline. Every item states its source: an AI report or a named player.
 */
export async function NewsFeed({ tournamentId }: { tournamentId: string }) {
  const supabase = await createServerSupabase();

  const { data: posts } = await supabase
    .from('news_posts')
    .select(
      'id, source, label, title, body, status, author_id, source_match_id, published_at, created_at, pinned',
    )
    .eq('tournament_id', tournamentId)
    .eq('status', 'published')
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(30);

  if (!posts || posts.length === 0) {
    return <EmptyState>لا توجد أخبار بعد.</EmptyState>;
  }

  const authorIds = posts.map((p) => p.author_id).filter((id): id is string => id !== null);
  const { data: authors } = authorIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', authorIds)
    : { data: [] };

  const byline = (post: (typeof posts)[number]) =>
    post.source === 'ai_reporter'
      ? 'AI Reporter'
      : post.source === 'system'
        ? 'النظام'
        : (authors?.find((a) => a.id === post.author_id)?.display_name ?? 'لاعب');

  const [lead, ...rest] = posts;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {lead ? (
        <article className="panel strip" style={{ padding: '20px 22px 24px' }}>
          <Meta post={lead} byline={byline(lead)} />
          <h2 style={{ fontSize: 'clamp(1.3rem, 3.4vw, 2rem)', marginBlock: '10px 10px' }}>
            {lead.title ?? byline(lead)}
          </h2>
          <p style={{ margin: 0, fontSize: 16, whiteSpace: 'pre-wrap' }}>{lead.body}</p>
          {lead.source_match_id ? (
            <Link
              href={`/match/${lead.source_match_id}`}
              style={{ display: 'inline-block', marginBlockStart: 14, color: 'var(--accent)', fontSize: 14 }}
            >
              عرض تفاصيل المباراة ←
            </Link>
          ) : null}
        </article>
      ) : null}

      {rest.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gap: 0,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            borderTop: '1px solid var(--line)',
          }}
        >
          {rest.map((post) => (
            <article
              key={post.id}
              style={{
                padding: '18px 18px 22px',
                borderBottom: '1px solid var(--line)',
                borderInlineStart: '1px solid var(--line)',
              }}
            >
              <Meta post={post} byline={byline(post)} />
              <h3 style={{ fontSize: 17, marginBlock: '8px 6px' }}>
                {post.title ?? byline(post)}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: 'var(--text-muted)',
                  whiteSpace: 'pre-wrap',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {post.body}
              </p>
              {post.source_match_id ? (
                <Link
                  href={`/match/${post.source_match_id}`}
                  style={{ display: 'inline-block', marginBlockStart: 10, fontSize: 13, color: 'var(--accent)' }}
                >
                  المباراة ←
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Meta({
  post,
  byline,
}: {
  post: { label: NewsLabel; published_at: string | null; created_at: string; pinned: boolean };
  byline: string;
}) {
  const date = post.published_at ?? post.created_at;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span
        className="tag"
        style={{
          borderColor: LABEL_COLOR[post.label] ?? 'var(--line-strong)',
          color: LABEL_COLOR[post.label] ?? 'inherit',
        }}
      >
        {LABEL_AR[post.label]}
      </span>
      {post.pinned ? <span className="tag">مثبت</span> : null}
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{byline}</span>
      <time
        dateTime={date}
        style={{ fontSize: 12, color: 'var(--text-muted)' }}
        className="numeric"
      >
        {new Date(date).toLocaleDateString('ar', { day: 'numeric', month: 'short' })}
      </time>
    </div>
  );
}
