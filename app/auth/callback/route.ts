import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Email-confirmation landing.
 *
 * Exchanges the code for a session and then returns the player to exactly where
 * they were, so nothing about where they were headed is lost on the way.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  // Only ever redirect within this origin.
  const target = next.startsWith('/') ? next : '/dashboard';

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(target, url.origin));
  }

  return NextResponse.redirect(new URL('/login?error=auth', url.origin));
}
