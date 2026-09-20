import { createAdminClient } from '@/lib/supabase/admin';
import { NewsModeration } from '@/components/admin/NewsModeration';

export const dynamic = 'force-dynamic';

export default async function AdminNewsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const admin = createAdminClient();

  const [{ data: tournament }, { data: posts }] = await Promise.all([
    admin.from('tournaments').select('ai_news_enabled, ai_news_mode').eq('id', id).maybeSingle(),
    admin
      .from('news_posts')
      .select('id, source, label, title, body, status, author_id, source_match_id, created_at, invalidation_reason')
      .eq('tournament_id', id)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  const authorIds = (posts ?? []).map((p) => p.author_id).filter((x): x is string => x !== null);
  const { data: authors } = authorIds.length
    ? await admin.from('profiles').select('id, display_name').in('id', authorIds)
    : { data: [] };

  return (
    <NewsModeration
      aiEnabled={tournament?.ai_news_enabled ?? false}
      aiMode={tournament?.ai_news_mode ?? 'review_first'}
      posts={(posts ?? []).map((p) => ({
        id: p.id,
        source: p.source,
        label: p.label,
        title: p.title,
        body: p.body,
        status: p.status,
        byline:
          p.source === 'ai_reporter'
            ? 'AI Reporter'
            : (authors?.find((a) => a.id === p.author_id)?.display_name ?? 'النظام'),
        matchId: p.source_match_id,
        createdAt: p.created_at,
        invalidationReason: p.invalidation_reason,
      }))}
    />
  );
}
