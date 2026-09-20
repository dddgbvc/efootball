import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage, verifyWebhookSecret } from '@/lib/telegram/client';
import { appUrl } from '@/lib/telegram/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
}

/**
 * Telegram webhook.
 *
 * Two independent guards: the shared secret header is compared in constant time
 * (a spoofed payload is rejected before it is parsed), and `update_id` is the
 * primary key of telegram_updates, so a replayed or duplicated delivery is
 * acknowledged without being processed twice.
 */
export async function POST(request: Request) {
  if (!verifyWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return new Response('forbidden', { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  if (typeof update.update_id !== 'number') {
    return new Response('bad request', { status: 400 });
  }

  const admin = createAdminClient();

  const { error: dedupeError } = await admin
    .from('telegram_updates')
    .insert({ update_id: update.update_id, payload: update as never });

  // Already handled — acknowledge so Telegram stops retrying.
  if (dedupeError) return Response.json({ ok: true, duplicate: true });

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat.id;

  if (!text || chatId === undefined) return Response.json({ ok: true });

  if (text.startsWith('/start')) {
    const token = text.slice('/start'.length).trim();

    if (!token) {
      await sendTelegramMessage({
        chatId,
        text: 'أهلاً بك 👋\nلربط حسابك، افتح لوحة الإدارة واضغط على «ربط Telegram».',
        buttons: [{ text: 'فتح لوحة الإدارة', url: appUrl('/admin') }],
      });
      return Response.json({ ok: true });
    }

    const { data: connection } = await admin
      .from('telegram_connections')
      .select('id, user_id, token_expires_at, linked_at')
      .eq('link_token', token)
      .maybeSingle();

    const expired =
      !connection ||
      (connection.token_expires_at !== null && new Date(connection.token_expires_at) < new Date());

    if (expired) {
      await sendTelegramMessage({
        chatId,
        text: '⚠️ رمز الربط غير صالح أو منتهي الصلاحية. أنشئ رمزاً جديداً من لوحة الإدارة.',
      });
      return Response.json({ ok: true });
    }

    await admin
      .from('telegram_connections')
      .update({
        chat_id: chatId,
        username: message?.from?.username ?? null,
        linked_at: new Date().toISOString(),
        link_token: null,
        token_expires_at: null,
        revoked_at: null,
      })
      .eq('id', connection.id);

    await admin.from('audit_logs').insert({
      actor_id: connection.user_id,
      action: 'TELEGRAM_LINKED',
      entity_type: 'telegram_connection',
      entity_id: connection.id,
    });

    await sendTelegramMessage({
      chatId,
      text: '✅ تم ربط حسابك بنجاح. ستصلك تنبيهات البطولات هنا.',
      buttons: [{ text: 'فتح لوحة الإدارة', url: appUrl('/admin') }],
    });

    return Response.json({ ok: true });
  }

  if (text === '/stop' || text === '/unlink') {
    await admin
      .from('telegram_connections')
      .update({ revoked_at: new Date().toISOString(), chat_id: null })
      .eq('chat_id', chatId);

    await sendTelegramMessage({ chatId, text: 'تم إيقاف التنبيهات. استخدم /start للربط مجدداً.' });
    return Response.json({ ok: true });
  }

  // Telegram is a notification channel, never a control surface: no command
  // here can change tournament state.
  await sendTelegramMessage({
    chatId,
    text: 'هذا البوت للتنبيهات فقط. كل إجراءات البطولة تتم من الموقع.',
    buttons: [{ text: 'فتح الموقع', url: appUrl('/') }],
  });

  return Response.json({ ok: true });
}
