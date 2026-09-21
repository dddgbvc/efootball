import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refreshes the Supabase auth cookie on every request so Server Components
 * always see a live session, and gates the authenticated route groups.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/admin') ||
    path.startsWith('/messages') ||
    path.startsWith('/community');

  const redirectToLogin = () => {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(redirect);
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Missing auth configuration must never crash public pages. Protected pages
  // fail closed and send the visitor to login instead of rendering privileged UI.
  if (!url || !key) {
    return isProtected ? redirectToLogin() : response;
  }

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.warn('[auth-middleware] getUser failed', {
        path,
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }

    if (!user && isProtected) {
      return redirectToLogin();
    }

    return response;
  } catch (error) {
    // A stale/corrupt auth cookie, temporary Supabase outage, or failed auth
    // refresh must not take the whole public site down. Protected routes still
    // fail closed.
    console.error('[auth-middleware] unexpected auth failure', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });

    return isProtected ? redirectToLogin() : response;
  }
}
