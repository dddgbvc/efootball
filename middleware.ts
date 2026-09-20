import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the Telegram webhook, which
     * authenticates itself with a shared secret rather than a session cookie.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/telegram|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
