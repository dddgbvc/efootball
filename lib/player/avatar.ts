/**
 * Avatar storage rules, shared by the uploader and every place that renders a
 * face. Both sides must agree on what is allowed, so it is written once.
 */

export const AVATAR_BUCKET = 'avatars';

/** Real image types only, checked against the file's bytes, not its name. */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/** Matches the bucket's own file_size_limit exactly, so the two never disagree. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const EXTENSION: Record<AvatarMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The magic numbers each accepted type starts with.
 *
 * A browser's reported MIME type is a claim, and a filename extension is less
 * than that. The first bytes of the file are the only part a caller cannot
 * simply assert.
 */
export function sniffImageType(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Storage paths are generated, never taken from the upload.
 *
 * The first segment is the owner's id, which is what the storage policy checks,
 * so a path can only ever be written into its owner's folder.
 */
export function avatarObjectPath(userId: string, type: AvatarMimeType, stamp = Date.now()): string {
  return `${userId}/${stamp}.${EXTENSION[type]}`;
}

export function avatarPublicUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`;
}
