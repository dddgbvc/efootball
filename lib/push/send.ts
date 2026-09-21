import 'server-only';

import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Web Push delivery.
 *
 * Push is a courtesy channel, never a source of truth: the notification row in
 * the database is the record, and this is a tap on the shoulder about it. A
 * failure here is logged and dropped rather than propagated, because a player
 * whose phone refused a notification has still been notified in the app.
 */

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  /** Collapses repeats of the same event on the lock screen. */
  tag?: string;
}

let configured: boolean | null = null;

function configure(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function pushConfigured(): boolean {
  return configure();
}

/** Sends to every device a player has registered. Returns how many landed. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; skipped: number }> {
  if (userIds.length === 0) return { sent: 0, skipped: 0 };
  if (!configure()) return { sent: 0, skipped: userIds.length };

  const admin = createAdminClient();
  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_secret')
    .in('user_id', userIds)
    .is('failed_at', null);

  if (!subscriptions || subscriptions.length === 0) return { sent: 0, skipped: userIds.length };

  const body = JSON.stringify(payload);
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: 'normal' },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away. Keeping it
        // would mean retrying a dead endpoint forever.
        if (status === 404 || status === 410) dead.push(sub.id);
        else console.error('[push] delivery failed', status, error);
      }
    }),
  );

  if (dead.length) {
    await admin.from('push_subscriptions').delete().in('id', dead);
  }

  return { sent, skipped: subscriptions.length - sent };
}

/**
 * Writes the in-app notification rows and pushes them in one call, so the two
 * can never drift apart.
 */
export async function notifyPlayers(
  rows: Array<{
    userId: string;
    tournamentId: string | null;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    eventKey?: string | null;
  }>,
  options: { push?: boolean } = { push: true },
) {
  if (rows.length === 0) return;

  const admin = createAdminClient();

  const { error } = await admin.from('notifications').insert(
    rows.map((row) => ({
      user_id: row.userId,
      tournament_id: row.tournamentId,
      type: row.type,
      title: row.title,
      body: row.body ?? null,
      link: row.link ?? null,
      event_key: row.eventKey ?? null,
    })),
  );

  if (error) {
    console.error('[notify] insert failed', error);
    return;
  }

  if (options.push === false) return;

  // Group by payload so one event is one push per device, not one per row.
  const byPayload = new Map<string, { payload: PushPayload; users: string[] }>();
  for (const row of rows) {
    const payload: PushPayload = {
      title: row.title,
      body: row.body ?? undefined,
      url: row.link ?? '/player',
      tag: row.eventKey ?? row.type,
    };
    const key = JSON.stringify(payload);
    const entry = byPayload.get(key);
    if (entry) entry.users.push(row.userId);
    else byPayload.set(key, { payload, users: [row.userId] });
  }

  for (const { payload, users } of byPayload.values()) {
    await sendPushToUsers(users, payload);
  }
}
