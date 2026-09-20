import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fallbackArticle, getReporterClient } from '@/lib/ai/reporter';
import type { ClassifiedEvent } from './classify';
import type { NewsLabel } from '@/types/database';

/**
 * Turns one verified official event into at most one article.
 *
 * `event_key` is unique in the database, so a retried pipeline run, a duplicate
 * webhook or a double-clicked admin action all converge on the same single
 * story. Nothing here ever reads an unverified result: the caller only produces
 * a ClassifiedEvent from official state.
 */
export async function publishOfficialEvent(
  tournamentId: string,
  event: ClassifiedEvent,
  sourceMatchId?: string,
): Promise<{ created: boolean; postId?: string; status?: string }> {
  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('ai_news_enabled, ai_news_mode')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!tournament?.ai_news_enabled) return { created: false };

  const { data: existing } = await admin
    .from('news_posts')
    .select('id')
    .eq('event_key', event.eventKey)
    .maybeSingle();

  if (existing) return { created: false, postId: existing.id };

  const reporter = getReporterClient();
  const outcome = reporter ? await reporter.write(event) : { ok: false as const };
  const article = outcome.ok && outcome.article ? outcome.article : fallbackArticle(event);

  const autoPublish = tournament.ai_news_mode === 'automatic';
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('news_posts')
    .insert({
      tournament_id: tournamentId,
      source: 'ai_reporter',
      label: event.label as NewsLabel,
      title: article.headline,
      body: article.body,
      status: autoPublish ? 'published' : 'draft',
      source_match_id: sourceMatchId ?? null,
      facts: event.facts as never,
      event_key: event.eventKey,
      published_at: autoPublish ? now : null,
    })
    .select('id')
    .maybeSingle();

  // A concurrent run won the unique index; that is the desired outcome.
  if (error || !data) return { created: false };

  return { created: true, postId: data.id, status: autoPublish ? 'published' : 'draft' };
}

export async function approveDraft(postId: string, adminUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('news_posts')
    .update({
      status: 'published',
      approved_by: adminUserId,
      published_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .eq('status', 'draft')
    .select('id, tournament_id')
    .maybeSingle();

  if (error || !data) throw new Error('DRAFT_NOT_FOUND_OR_ALREADY_PUBLISHED');
  return data;
}
