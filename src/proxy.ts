import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Keeps the Supabase session cookie fresh on every page load, and sends signed-out visitors to the
 * sign-in page. This is only the quick check: who is actually allowed in (an active member) is
 * decided on the server by the sign-in routes, /api/me and the database's row level security.
 */
const PUBLIC = ['/login', '/auth/'];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without Supabase, Our Build runs in this-browser-only mode with no accounts.
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  const { data } = await sb.auth.getClaims();

  const path = request.nextUrl.pathname;
  if (!data?.claims && !PUBLIC.some((p) => path === p || path.startsWith(p))) {
    const to = new URL('/login', request.url);
    if (path !== '/') to.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  // Pages only: API routes check for themselves, and static files need no session.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)'],
};
