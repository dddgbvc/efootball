import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';

/**
 * Issues a short-lived, single-use linking token.
 *
 * The admin opens the bot with `/start <token>`; the webhook trades it for the
 * chat id and clears it. The bot token itself never leaves the server.
 */
export async function POST() {
  try {
    const user = await requireAuthenticated();

    const limit = rateLimit(`tg-link:${user.id}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'حاول بعد قليل', 429);

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!process.env.TELEGRAM_BOT_TOKEN || !botUsername) {
      return fail('TELEGRAM_NOT_CONFIGURED', 'لم يتم إعداد بوت Telegram على الخادم', 503);
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const admin = createAdminClient();
    const { error } = await admin.from('telegram_connections').upsert(
      {
        user_id: user.id,
        link_token: token,
        token_expires_at: expiresAt,
      },
      { onConflict: 'user_id' },
    );

    if (error) throw new Error(error.message);

    return ok({
      deepLink: `https://t.me/${botUsername}?start=${token}`,
      expiresAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireAuthenticated();
    const admin = createAdminClient();

    await admin
      .from('telegram_connections')
      .update({ revoked_at: new Date().toISOString(), chat_id: null, link_token: null })
      .eq('user_id', user.id);

    return ok({ revoked: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
