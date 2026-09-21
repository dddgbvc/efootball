import Link from 'next/link';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { NotificationBell } from './NotificationBell';

const NAV_PUBLIC: Array<[href: string, label: string]> = [
  ['/tournaments', 'البطولات'],
  ['/news', 'الأخبار'],
];

const NAV_SIGNED_IN: Array<[href: string, label: string]> = [
  ['/dashboard', 'لوحتي'],
  ['/messages', 'الرسائل'],
];

export async function SiteHeader() {
  let user = null;
  let displayName: string | null = null;

  try {
    user = await getCurrentUser();
    if (user) {
      const supabase = await createServerSupabase();
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      displayName = data?.display_name ?? null;
    }
  } catch {
    // Supabase not configured yet; the header still renders.
  }

  const links = user ? [...NAV_PUBLIC, ...NAV_SIGNED_IN] : NAV_PUBLIC;

  return (
    <header className="site-header">
      <div
        className="shell site-header-inner"
        style={{ display: 'flex', alignItems: 'center', gap: 24, minHeight: 66 }}
      >
        <Link
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0 }}
        >
          <span aria-hidden className="brand-mark" />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: '-0.015em',
            }}
          >
            eFootball
          </span>
        </Link>

        <nav
          aria-label="التنقل الرئيسي"
          style={{ display: 'flex', gap: 20, fontSize: 14, fontWeight: 600, overflowX: 'auto' }}
        >
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="site-nav-link">
              {label}
            </Link>
          ))}
        </nav>

        <div
          style={{
            marginInlineStart: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexShrink: 0,
          }}
        >
          {user ? (
            <>
              <NotificationBell />
              <Link
                href="/dashboard/profile"
                className="site-nav-link site-header-account"
                style={{ fontSize: 14, fontWeight: 700 }}
              >
                {displayName ?? 'حسابي'}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="site-nav-link" style={{ fontSize: 14 }}>
                دخول
              </Link>
              <Link
                href="/register"
                className="btn btn-primary site-header-cta"
                style={{ minHeight: 38 }}
              >
                إنشاء حساب
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
