import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { isAdminUser } from './lib/admin-policy.js';

export async function proxy(request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return request.nextUrl.pathname === '/login' ? NextResponse.next() : NextResponse.redirect(new URL('/login', request.url));
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(6_000) }) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) response.cookies.set(name, value, options);
      },
    },
  });
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (request.nextUrl.pathname !== '/login' && !isAdminUser(user)) {
      const redirect = NextResponse.redirect(new URL('/login', request.url));
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  } catch {
    if (request.nextUrl.pathname !== '/login') return NextResponse.redirect(new URL('/login', request.url));
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/', '/admin/:path*', '/login'] };
