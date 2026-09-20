import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthenticated, isTournamentParticipant, isTournamentAdmin } from '@/lib/permissions';
import { newsPostSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';

/**
 * Player posts.
 *
 * Inserted as the user through RLS, whose WITH CHECK pins source='player',
 * author_id=auth.uid(), label='PLAYER_POST' and source_match_id=null — so a
 * crafted request cannot publish something that looks like an AI or system
 * story, and a player post can never touch official tournament state.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();
    const input = await parseBody(request, newsPostSchema);

    const limit = rateLimit(`news:${user.id}`, 12, 60 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'تجاوزت حد النشر', 429);

    const allowed =
      (await isTournamentParticipant(input.tournamentId, user.id)) ||
      (await isTournamentAdmin(input.tournamentId, user.id));
    if (!allowed) return fail('FORBIDDEN', 'يجب أن تكون مشاركاً في البطولة للنشر', 403);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('news_posts')
      .insert({
        tournament_id: input.tournamentId,
        source: 'player',
        label: 'PLAYER_POST',
        author_id: user.id,
        body: input.body,
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    if (error || !data) return fail('POST_REJECTED', error?.message ?? 'تعذر النشر', 403);

    if (input.mediaPaths && input.mediaPaths.length > 0) {
      const admin = createAdminClient();
      const prefix = `${input.tournamentId}/`;
      const valid = input.mediaPaths.filter((p) => p.startsWith(prefix));

      if (valid.length > 0) {
        await admin.from('news_post_media').insert(
          valid.map((path) => ({
            post_id: data.id,
            storage_path: path,
            mime_type: 'image/webp',
            byte_size: 1,
          })),
        );
      }
    }

    return ok({ postId: data.id }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
