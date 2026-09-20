import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.telegram.org';

export interface InlineButton {
  text: string;
  url: string;
}

export interface TelegramMessage {
  chatId: number;
  text: string;
  buttons?: InlineButton[];
}

export type TelegramSendResult =
  | { ok: true; messageId: number }
  | { ok: false; error: string; retryable: boolean };

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Sends one message. The bot token is read from the server environment and is
 * never exposed to a client bundle — this module is `server-only`.
 *
 * A failure here is reported, not thrown: Telegram delivery must never block or
 * corrupt official match verification (§86).
 */
export async function sendTelegramMessage(message: TelegramMessage): Promise<TelegramSendResult> {
  const token = botToken();
  if (!token) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured', retryable: false };
  }

  const body: Record<string, unknown> = {
    chat_id: message.chatId,
    text: message.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (message.buttons && message.buttons.length > 0) {
    body.reply_markup = {
      inline_keyboard: message.buttons.map((b) => [{ text: b.text, url: b.url }]),
    };
  }

  try {
    const response = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const json = (await response.json()) as {
      ok: boolean;
      result?: { message_id: number };
      description?: string;
    };

    if (!response.ok || !json.ok) {
      return {
        ok: false,
        error: json.description ?? `HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    return { ok: true, messageId: json.result?.message_id ?? 0 };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

export async function setWebhook(publicUrl: string): Promise<TelegramSendResult> {
  const token = botToken();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET missing', retryable: false };
  }

  const response = await fetch(`${API_BASE}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${publicUrl.replace(/\/$/, '')}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ['message'],
    }),
  });

  const json = (await response.json()) as { ok: boolean; description?: string };
  return json.ok
    ? { ok: true, messageId: 0 }
    : { ok: false, error: json.description ?? 'setWebhook failed', retryable: true };
}

/**
 * Constant-time comparison of the `X-Telegram-Bot-Api-Secret-Token` header
 * against the configured secret. Anything else is a spoofed payload.
 */
export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !headerValue) return false;

  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Signs the one-time account-linking token carried in `/start <token>`. */
export function signLinkToken(userId: string, nonce: string): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  return createHmac('sha256', secret).update(`${userId}:${nonce}`).digest('hex').slice(0, 32);
}
