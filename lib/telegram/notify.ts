import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from './client';
import type { Composed } from './messages';

/**
 * Queues an admin alert and attempts immediate delivery.
 *
 * The outbox row is written first and keyed by `event_key`, so a duplicated
 * pipeline run enqueues nothing twice, and a Telegram outage leaves a pending
 * row to retry rather than a lost notification. Delivery failure never
 * propagates to the caller: the database stays the source of truth (§86).
 */
export async function notifyTournamentAdmins(
  tournamentId: string,
  eventKey: string,
  message: Composed,
): Promise<{ queued: number; sent: number }> {
  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('telegram_enabled')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!tournament?.telegram_enabled) return { queued: 0, sent: 0 };

  const { data: admins } = await admin
    .from('tournament_admins')
    .select('user_id')
    .eq('tournament_id', tournamentId);

  if (!admins || admins.length === 0) return { queued: 0, sent: 0 };

  const { data: connections } = await admin
    .from('telegram_connections')
    .select('user_id, chat_id')
    .in(
      'user_id',
      admins.map((a) => a.user_id),
    )
    .is('revoked_at', null)
    .not('chat_id', 'is', null);

  if (!connections || connections.length === 0) return { queued: 0, sent: 0 };

  let queued = 0;
  let sent = 0;

  for (const connection of connections) {
    if (connection.chat_id === null) continue;

    const rowKey = `${eventKey}:${connection.chat_id}`;
    const { data: row, error } = await admin
      .from('telegram_outbox')
      .insert({
        tournament_id: tournamentId,
        event_key: rowKey,
        chat_id: connection.chat_id,
        text_body: message.text,
        reply_markup:
          message.buttons.length > 0
            ? { inline_keyboard: message.buttons.map((b) => [{ text: b.text, url: b.url }]) }
            : null,
      })
      .select('id')
      .maybeSingle();

    // Duplicate event_key: this alert was already queued by an earlier run.
    if (error || !row) continue;
    queued += 1;

    const result = await sendTelegramMessage({
      chatId: connection.chat_id,
      text: message.text,
      buttons: message.buttons,
    });

    if (result.ok) {
      sent += 1;
      await admin
        .from('telegram_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: 1 })
        .eq('id', row.id);
    } else {
      await admin
        .from('telegram_outbox')
        .update({
          status: result.retryable ? 'pending' : 'failed',
          attempts: 1,
          last_error: result.error,
        })
        .eq('id', row.id);
    }
  }

  return { queued, sent };
}

/** Drains pending outbox rows. Safe to call repeatedly. */
export async function retryPendingTelegram(limit = 25): Promise<{ retried: number; sent: number }> {
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from('telegram_outbox')
    .select('id, chat_id, text_body, reply_markup, attempts')
    .eq('status', 'pending')
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (!rows || rows.length === 0) return { retried: 0, sent: 0 };

  let sent = 0;
  for (const row of rows) {
    const markup = row.reply_markup as { inline_keyboard?: Array<Array<{ text: string; url: string }>> } | null;
    const buttons = markup?.inline_keyboard?.flat() ?? [];

    const result = await sendTelegramMessage({
      chatId: row.chat_id,
      text: row.text_body,
      buttons,
    });

    if (result.ok) {
      sent += 1;
      await admin
        .from('telegram_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id);
    } else {
      await admin
        .from('telegram_outbox')
        .update({
          status: row.attempts + 1 >= 5 ? 'failed' : 'pending',
          attempts: row.attempts + 1,
          last_error: result.error,
        })
        .eq('id', row.id);
    }
  }

  return { retried: rows.length, sent };
}
