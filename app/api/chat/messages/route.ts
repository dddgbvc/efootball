import { createServerSupabase } from '@/lib/supabase/server';
import { requireChatMember } from '@/lib/permissions';
import { chatMessageSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';

/**
 * Sends a chat message as the signed-in user.
 *
 * The insert goes through RLS, whose WITH CHECK requires sender_id = auth.uid(),
 * kind = 'user', system_event IS NULL and membership of the room — so a forged
 * system message or a post into someone else's conversation is impossible even
 * if the request body says otherwise.
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, chatMessageSchema);
    const { user } = await requireChatMember(input.roomId);

    const limit = rateLimit(`chat:${user.id}`, 60, 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'أرسلت رسائل كثيرة بسرعة', 429);

    const hasBody = Boolean(input.body && input.body.trim().length > 0);
    const hasAttachments = Boolean(input.attachments && input.attachments.length > 0);
    if (!hasBody && !hasAttachments) {
      return fail('EMPTY_MESSAGE', 'الرسالة فارغة', 422);
    }

    const supabase = await createServerSupabase();

    const { data: message, error } = await supabase
      .from('chat_messages')
      .insert({
        room_id: input.roomId,
        sender_id: user.id,
        kind: 'user',
        body: input.body?.trim() ?? null,
        reply_to_id: input.replyToId ?? null,
      })
      .select('id, created_at')
      .maybeSingle();

    if (error || !message) {
      return fail('MESSAGE_REJECTED', error?.message ?? 'تعذر إرسال الرسالة', 403);
    }

    if (hasAttachments) {
      const prefix = `${input.roomId}/${user.id}/`;
      const rows = input
        .attachments!.filter((a) => a.storagePath.startsWith(prefix))
        .map((a) => ({
          message_id: message.id,
          room_id: input.roomId,
          storage_path: a.storagePath,
          mime_type: a.mimeType,
          byte_size: a.byteSize,
          width: a.width ?? null,
          height: a.height ?? null,
        }));

      if (rows.length !== input.attachments!.length) {
        return fail('ATTACHMENT_PATH_INVALID', 'مسار المرفق غير صالح', 400);
      }
      if (rows.length > 0) {
        const { error: attachError } = await supabase
          .from('chat_message_attachments')
          .insert(rows);
        if (attachError) return fail('ATTACHMENT_REJECTED', attachError.message, 403);
      }
    }

    await supabase.rpc('mark_room_read', {
      p_room_id: input.roomId,
      p_message_id: message.id,
    });

    return ok({ messageId: message.id, createdAt: message.created_at }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
