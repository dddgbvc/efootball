import Link from 'next/link';
import { getCurrentUser } from '@/lib/supabase/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { NotificationBell } from './NotificationBell';

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

  return (
    <header
      style={{
        position: 'relative',
        zIndex: 2,
        borderBottom: '1px solid var(--line)',
        background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
        backdropFilter: 'saturate(140%) blur(6px)',
      }}
    >
      <div
        className="shell site-header-inner"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          minHeight: 62,
        }}
      >
        <Link
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800 }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 10,
              height: 22,
              background: 'var(--accent)',
              clipPath: 'polygon(0 0, 100% 0, 70% 100%, 0 100%)',
            }}
          />
          <span style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
            eFootball
          </span>
        </Link>

        <nav
          aria-label="التنقل الرئيسي"
          style={{ display: 'flex', gap: 18, fontSize: 14, overflowX: 'auto' }}
        >
          <Link href="/tournaments">البطولات</Link>
          <Link href="/news">الأخبار</Link>
          {user ? <Link href="/dashboard">لوحتي</Link> : null}
          {user ? <Link href="/messages">الرسائل</Link> : null}
        </nav>

        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {user ? (
            <>
              <NotificationBell />
              <Link href="/dashboard/profile" style={{ fontSize: 14, fontWeight: 600 }}>
                {displayName ?? 'حسابي'}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" style={{ fontSize: 14 }}>
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
