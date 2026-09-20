import 'server-only';

import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Invite secrets are CSPRNG output, never derived from a row id.
 *
 * The token is what appears in the URL and is matched in the database; the
 * short code is a human-typeable alias scoped to one tournament. Both come from
 * separate random draws, so neither can be guessed from the other.
 */
export function generateInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

export function generateInviteCode(capacity: number): string {
  const body = Array.from(randomBytes(4))
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('');
  return `EF${capacity}-${body}`;
}

export function inviteUrl(token: string): string {
  const fallbackHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ??
    (fallbackHost ? `https://${fallbackHost}` : 'http://localhost:3000')
  ).replace(/\/$/, '');
  return `${base}/join/${token}`;
}

/**
 * QR rendered server-side, so an invite secret never reaches a third-party
 * QR service.
 */
export async function qrCodeSvg(text: string, size = 256): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#07090c', light: '#ffffff' },
  });
}
