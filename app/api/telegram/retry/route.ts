import { retryPendingTelegram } from '@/lib/telegram/notify';
import { handleRouteError, ok } from '@/lib/api/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Drains the Telegram outbox.
 *
 * Intended for a Vercel Cron entry (see vercel.json). Protected by
 * CRON_SECRET so it cannot be triggered by an anonymous caller.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const provided =
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      new URL(request.url).searchParams.get('secret');

    if (!secret || provided !== secret) {
      return new Response('forbidden', { status: 403 });
    }

    const result = await retryPendingTelegram();
    return ok(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
