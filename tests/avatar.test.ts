import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  avatarObjectPath,
  sniffImageType,
} from '@/lib/player/avatar';

/**
 * The upload route's gate.
 *
 * A browser's Content-Type is a claim and a filename extension is less than
 * that, so the only thing worth testing is what the route actually decides on:
 * the first bytes of the file, and the path it generates for them.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);

describe('sniffImageType', () => {
  it('recognises the three accepted formats by their magic numbers', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects a file that merely claims to be an image', () => {
    const phpInDisguise = new TextEncoder().encode('<?php system($_GET["c"]); ?>');
    expect(sniffImageType(phpInDisguise)).toBeNull();

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(sniffImageType(svg)).toBeNull();

    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffImageType(gif)).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('rejects a truncated header rather than reading past the end', () => {
    expect(sniffImageType(PNG.slice(0, 4))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(Uint8Array.from([0xff]))).toBeNull();
  });

  it('only ever returns a type the bucket accepts', () => {
    for (const bytes of [PNG, JPEG, WEBP]) {
      const type = sniffImageType(bytes);
      expect(type).not.toBeNull();
      expect(AVATAR_MIME_TYPES).toContain(type!);
    }
  });
});

describe('avatarObjectPath', () => {
  const user = '11111111-2222-3333-4444-555555555555';

  it('puts the object in the owner’s folder, which is what the policy checks', () => {
    const path = avatarObjectPath(user, 'image/png', 1000);
    expect(path.split('/')[0]).toBe(user);
  });

  it('never carries anything the uploader supplied', () => {
    const path = avatarObjectPath(user, 'image/jpeg', 1000);
    // Only the id, a timestamp and an extension derived from the sniffed type.
    expect(path).toBe(`${user}/1000.jpg`);
    expect(path).not.toMatch(/\.\./);
  });

  it('gives a replacement its own name so a stale CDN copy cannot win', () => {
    const first = avatarObjectPath(user, 'image/webp', 1000);
    const second = avatarObjectPath(user, 'image/webp', 1001);
    expect(first).not.toBe(second);
  });
});

describe('AVATAR_MAX_BYTES', () => {
  it('matches the bucket limit declared in the storage migration', () => {
    // supabase/migrations/...storage.sql sets file_size_limit to 2097152.
    expect(AVATAR_MAX_BYTES).toBe(2097152);
  });
});
