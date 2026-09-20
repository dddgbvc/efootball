import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { EmptyState } from '@/components/StandingsTable';

export const metadata = { title: 'آخر الأخبار' };
export const dynamic = 'force-dynamic';

export default async function GlobalNewsPage() {
  const supabase = await createServerSupabase();

  const { data: posts } = await supabase
    .from('news_posts')
    .select('id, tournament_id, source, label, title, body, published_at, author_id, source_match_id')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(40);

  const tournamentIds = [...new Set((posts ?? []).map((p) => p.tournament_id))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name, slug').in('id', tournamentIds)
    : { data: [] };

  const authorIds = (posts ?? []).map((p) => p.author_id).filter((x): x is string => x !== null);
  const { data: authors } = authorIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', authorIds)
    : { data: [] };

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px', maxWidth: 860 }}>
      <div className="eyebrow">غرفة الأخبار</div>
      <h1 style={{ fontSize: 34, marginBlock: '10px 28px' }}>آخر الأخبار</h1>

      {!posts || posts.length === 0 ? (
        <EmptyState>لا توجد أخبار منشورة.</EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--line)' }}>
          {posts.map((post) => {
            const tournament = tournaments?.find((t) => t.id === post.tournament_id);
            const byline =
              post.source === 'ai_reporter'
                ? 'AI Reporter'
                : post.source === 'system'
                  ? 'النظام'
                  : (authors?.find((a) => a.id === post.author_id)?.display_name ?? 'لاعب');

            return (
              <article
                key={post.id}
                style={{ padding: '20px 0', borderBottom: '1px solid var(--line)' }}
              >
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="tag">{post.label}</span>
                  {tournament ? (
                    <Link
                      href={`/tournaments/${tournament.slug}?tab=news`}
                      style={{ fontSize: 12, color: 'var(--accent)' }}
                    >
                      {tournament.name}
                    </Link>
                  ) : null}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{byline}</span>
                  {post.published_at ? (
                    <time
                      dateTime={post.published_at}
                      className="numeric"
                      style={{ fontSize: 12, color: 'var(--text-muted)' }}
                    >
                      {new Date(post.published_at).toLocaleDateString('ar', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </time>
                  ) : null}
                </div>

                <h2 style={{ fontSize: 21, marginBlock: '10px 8px' }}>{post.title ?? byline}</h2>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{post.body}</p>

                {post.source_match_id ? (
                  <Link
                    href={`/match/${post.source_match_id}`}
                    style={{ display: 'inline-block', marginBlockStart: 10, fontSize: 13, color: 'var(--accent)' }}
                  >
                    تفاصيل المباراة ←
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
