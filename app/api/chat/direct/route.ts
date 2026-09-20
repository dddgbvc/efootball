import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

const schema = z.object({ userId: z.string().uuid() });

const MESSAGES: Record<string, string> = {
  INVALID_TARGET: 'لا يمكنك مراسلة نفسك',
  USER_NOT_FOUND: 'اللاعب غير موجود',
  BLOCKED: 'لا يمكن فتح محادثة مع هذا اللاعب',
};

/**
 * Opens (or reuses) the one-to-one conversation with another player.
 *
 * The room is keyed by the unordered pair in the database, so repeated calls
 * from either side converge on a single conversation instead of creating
 * duplicates.
 */
export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const { userId } = await parseBody(request, schema);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('open_direct_room', { p_other_user: userId });

    if (error) throw new Error(error.message);

    const result = data as { ok: boolean; error?: string; room_id?: string };
    if (!result.ok) {
      const code = result.error ?? 'DM_FAILED';
      return fail(code, MESSAGES[code] ?? 'تعذر فتح المحادثة', 409);
    }

    return ok({ roomId: result.room_id });
  } catch (error) {
    return handleRouteError(error);
  }
}
