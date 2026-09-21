import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadPlayerContext } from '@/lib/player/context';
import { PlayerNav } from '@/components/player/PlayerNav';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'بوابة اللاعب' };

/**
 * The portal shell.
 *
 * Two things are settled here and nowhere else: that the visitor is a player
 * in a tournament at all, and that they have accepted the rules in force. The
 * rules screen sits outside the second check — gating it behind itself is the
 * classic way to build a redirect loop.
 */
export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const result = await loadPlayerContext();

  if (!result.ok) {
    if (result.reason === 'unauthenticated') redirect('/login?next=/player');
    return (
      <div className="shell" style={{ paddingBlock: '56px 96px', maxWidth: 560 }}>
        <div className="panel strip" style={{ padding: '28px 22px 30px' }}>
          <div className="eyebrow">بوابة اللاعب</div>
          <h1 style={{ fontSize: 24, marginBlock: '10px 12px' }}>لست مشاركاً في أي بطولة</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 20px' }}>
            تُفتح بوابة اللاعب عبر رابط دعوة يرسله منظّم البطولة. إن كان معك رابط، افتحه
            لإكمال الانضمام.
          </p>
          <Link href="/tournaments" className="btn">
            تصفح البطولات العامة
          </Link>
        </div>
      </div>
    );
  }

  const { context } = result;

  return (
    <div className="player-shell">
      <header className="player-header">
        <div className="player-header-inner">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>
              بطولتك
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 16,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {context.tournament.name}
            </div>
          </div>
          <span
            aria-hidden
            className="player-header-accent"
            style={{ background: context.tournament.accentColor }}
          />
        </div>
      </header>

      <main className="player-main">{children}</main>

      <PlayerNav />
    </div>
  );
}
