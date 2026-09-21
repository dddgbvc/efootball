import { avatarPublicUrl } from '@/lib/player/avatar';

/**
 * A player's face, or their initials.
 *
 * Never a stock photograph of a stranger: an invented face reads as a real
 * person to everyone who sees it. Initials are honest about being a
 * placeholder, and the hue is derived from the name so the same player is the
 * same colour everywhere in the app.
 */
export function Avatar({
  path,
  name,
  size = 40,
}: {
  path: string | null;
  name: string;
  size?: number;
}) {
  const url = avatarPublicUrl(path);
  const initials = initialsOf(name);
  const hue = hueOf(name);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="avatar"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="avatar avatar-initials"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `oklch(0.32 0.06 ${hue})`,
        color: `oklch(0.9 0.08 ${hue})`,
      }}
    >
      {initials}
    </span>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2);
  return `${(parts[0] ?? '').charAt(0)}${(parts[1] ?? '').charAt(0)}`;
}

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
