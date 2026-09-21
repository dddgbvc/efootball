import { createServerSupabase } from '@/lib/supabase/server';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail } from '@/lib/api/respond';
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  avatarObjectPath,
  avatarPublicUrl,
  sniffImageType,
} from '@/lib/player/avatar';

export const runtime = 'nodejs';

/**
 * Profile photo upload.
 *
 * Every write here runs under the caller's own session, so the storage policy
 * — which requires the first path segment to be the caller's own id — is what
 * ultimately decides. This handler's job is to make sure the bytes really are
 * an image and that the path is generated rather than supplied.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();

    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return fail('VALIDATION_FAILED', 'لم يتم إرسال ملف', 422);
    }
    if (file.size === 0) {
      return fail('VALIDATION_FAILED', 'الملف فارغ', 422);
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return fail(
        'FILE_TOO_LARGE',
        `حجم الصورة أكبر من ${Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} ميجابايت`,
        413,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // The declared content type and the filename are both caller-controlled.
    // The first bytes are not.
    const type = sniffImageType(bytes);
    if (!type) {
      return fail('UNSUPPORTED_TYPE', 'الصيغ المقبولة: JPG أو PNG أو WebP', 415);
    }

    const supabase = await createServerSupabase();

    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_path')
      .eq('id', user.id)
      .maybeSingle();

    const path = avatarObjectPath(user.id, type);

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType: type, upsert: false });

    if (uploadError) {
      return fail('UPLOAD_FAILED', 'تعذر رفع الصورة', 400);
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', user.id);

    if (updateError) {
      // Do not leave an orphan behind if the row could not be pointed at it.
      await supabase.storage.from(AVATAR_BUCKET).remove([path]);
      return fail('UPLOAD_FAILED', 'تعذر حفظ الصورة في ملفك', 400);
    }

    // Replacing a photo should not accumulate every previous one.
    if (profile?.avatar_path && profile.avatar_path !== path) {
      await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_path]);
    }

    return ok({ path, url: avatarPublicUrl(path) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireAuthenticated();
    const supabase = await createServerSupabase();

    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_path')
      .eq('id', user.id)
      .maybeSingle();

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', user.id);

    if (error) return fail('DELETE_FAILED', 'تعذر حذف الصورة', 400);

    if (profile?.avatar_path) {
      await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_path]);
    }

    return ok({ path: null });
  } catch (error) {
    return handleRouteError(error);
  }
}
