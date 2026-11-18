import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { authorizationUrl } from '@/lib/google';
import { createOAuthState, OAUTH_COOKIE } from '@/lib/oauth-state';
import { validEmail } from '@/lib/otp-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  const accountId = request.nextUrl.searchParams.get('account');
  if (!/^[a-f0-9-]{36}$/i.test(accountId || '')) return NextResponse.json({ message: 'Akun tidak valid.' }, { status: 400 });
  try {
    const db = createSupabaseAdmin();
    const { data: account, error } = await db.from('otp_accounts').select('id,disney_email').eq('id', accountId).eq('service', 'disney').single();
    if (error || !validEmail(account?.disney_email)) throw new Error('account_missing');
    const oauth = createOAuthState(account.id, user.id);
    const response = NextResponse.redirect(authorizationUrl({ ...oauth, email: account.disney_email }));
    response.cookies.set(OAUTH_COOKIE, oauth.cookie, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/google', maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.redirect(new URL('/admin?notice=connect_failed', request.url));
  }
}
