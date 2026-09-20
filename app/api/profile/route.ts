import { createServerSupabase } from '@/lib/supabase/server';
import { requireAuthenticated } from '@/lib/permissions';
import { updateProfileSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  try {
    const user = await requireAuthenticated();
    const input = await parseBody(request, updateProfileSchema);

    // The avatar must live under the caller's own folder; the Storage policy
    // enforces the same shape on write.
    if (input.avatarPath && !input.avatarPath.startsWith(`${user.id}/`)) {
      return fail('AVATAR_PATH_INVALID', 'مسار الصورة غير صالح', 400);
    }

    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: input.displayName,
        full_name: input.fullName ?? null,
        efootball_name: input.efootballName ?? null,
        efootball_id: input.efootballId ?? null,
        platform: input.platform ?? null,
        phone: input.phone ?? null,
        telegram_username: input.telegramUsername ?? null,
        bio: input.bio ?? null,
        ...(input.avatarPath !== undefined ? { avatar_path: input.avatarPath } : {}),
      })
      .eq('id', user.id);

    if (error) return fail('PROFILE_UPDATE_REJECTED', error.message, 403);

    return ok({ updated: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
