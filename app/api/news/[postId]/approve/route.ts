import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin, writeAuditLog, AuthorizationError } from '@/lib/permissions';
import { approveDraft } from '@/lib/news/publish';
import { handleRouteError, ok, fail } from '@/lib/api/respond';

export const runtime = 'nodejs';

/** Review First workflow: an AI draft only becomes public when an admin says so. */
export async function POST(_request: Request, context: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await context.params;

    const admin = createAdminClient();
    const { data: post } = await admin
      .from('news_posts')
      .select('id, tournament_id, status, source')
      .eq('id', postId)
      .maybeSingle();

    if (!post) throw new AuthorizationError('NOT_FOUND', 'الخبر غير موجود');

    const user = await requireTournamentAdmin(post.tournament_id);

    if (post.status !== 'draft') return fail('NOT_A_DRAFT', 'هذا الخبر ليس مسودة', 409);

    await approveDraft(postId, user.id);

    await writeAuditLog({
      tournamentId: post.tournament_id,
      actorId: user.id,
      action: 'NEWS_APPROVED',
      entityType: 'news_post',
      entityId: postId,
    });

    return ok({ published: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await context.params;

    const admin = createAdminClient();
    const { data: post } = await admin
      .from('news_posts')
      .select('id, tournament_id')
      .eq('id', postId)
      .maybeSingle();
    if (!post) throw new AuthorizationError('NOT_FOUND');

    const user = await requireTournamentAdmin(post.tournament_id);

    await admin.from('news_posts').update({ status: 'archived' }).eq('id', postId);

    await writeAuditLog({
      tournamentId: post.tournament_id,
      actorId: user.id,
      action: 'NEWS_MODERATED',
      entityType: 'news_post',
      entityId: postId,
    });

    return ok({ archived: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
