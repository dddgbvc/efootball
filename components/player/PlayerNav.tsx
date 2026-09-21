'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The portal's only navigation: five destinations, thumb-height, pinned to the
 * bottom of the viewport above the home indicator. Nothing from the organiser's
 * console appears here — a player has no route into it from the portal.
 */
const ITEMS: Array<[href: string, label: string, icon: () => React.ReactElement]> = [
  ['/player', 'الرئيسية', () => HomeIcon()],
  ['/player/matches', 'مبارياتي', () => MatchIcon()],
  ['/player/standings', 'الترتيب', () => TableIcon()],
  ['/player/chat', 'المحادثات', () => ChatIcon()],
  ['/player/profile', 'حسابي', () => UserIcon()],
];

export function PlayerNav() {
  const pathname = usePathname();

  return (
    <nav className="player-nav" aria-label="تنقل بوابة اللاعب">
      {ITEMS.map(([href, label, icon]) => {
        const active = href === '/player' ? pathname === '/player' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className="player-nav-item"
            aria-current={active ? 'page' : undefined}
          >
            <span aria-hidden className="player-nav-icon">
              {icon()}
            </span>
            <span className="player-nav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* Icons are inline so the portal ships no icon library. 1.5px strokes on a
   24px box, which is what the rest of the interface uses. */
function svg(children: React.ReactNode) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const HomeIcon = () => svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /></>);
const MatchIcon = () =>
  svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /></>);
const TableIcon = () =>
  svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17M3.5 14.5h17" /></>);
const ChatIcon = () => svg(<path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4a9.8 9.8 0 0 1-2.8-.4L4 20.5l1.6-3.7A7 7 0 0 1 3.5 12C3.5 7.9 7.3 4.6 12 4.6s8.5 3.3 8.5 7.4Z" />);
const UserIcon = () =>
  svg(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20c.9-3.6 3.8-5.6 7.2-5.6S18.3 16.4 19.2 20" /></>);
