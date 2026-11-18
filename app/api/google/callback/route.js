import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { exchangeCode, gmailProfile } from '@/lib/google';
import { verifyOAuthState, OAUTH_COOKIE } from '@/lib/oauth-state';
import { mailboxIdentity } from '@/lib/otp-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  let notice = 'connect_failed';
  try {
    const state = verifyOAuthState(request.cookies.get(OAUTH_COOKIE)?.value, request.nextUrl.searchParams.get('state'), user.id);
    if (request.nextUrl.searchParams.get('error')) throw new Error('oauth_cancelled');
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new Error('missing_code');
    const db = createSupabaseAdmin();
    const { data: account, error } = await db.from('otp_accounts').select('id,disney_email').eq('id', state.accountId).eq('service', 'disney').single();
    if (error || !account?.disney_email) throw new Error('account_missing');
    const tokens = await exchangeCode(code, state.verifier);
    const email = await gmailProfile(tokens.access_token);
    if (mailboxIdentity(email) !== mailboxIdentity(account.disney_email)) {
      notice = 'wrong_email';
      throw new Error('account_mismatch');
    }
    const { data: old, error: oldError } = await db.from('gmail_tokens').select('refresh_token,gmail_email').eq('otp_account_id', account.id).maybeSingle();
    if (oldError) throw new Error('database_unavailable');
    // A missing refresh token must not erase a valid token for the SAME mailbox.
    const refreshToken = tokens.refresh_token || (old?.gmail_email && mailboxIdentity(old.gmail_email) === mailboxIdentity(email) ? old.refresh_token : null);
    if (!refreshToken) { notice = 'refresh_missing'; throw new Error('refresh_missing'); }
    const { error: saveError } = await db.from('gmail_tokens').upsert({
      otp_account_id: account.id, access_token: tokens.access_token, refresh_token: refreshToken,
      expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      gmail_email: email, connection_version: randomUUID(),
    }, { onConflict: 'otp_account_id' });
    if (saveError) throw new Error('database_unavailable');
    notice = 'connected';
  } catch { /* A fixed notice is safe; OAuth codes and tokens never enter logs. */ }
  const response = NextResponse.redirect(new URL('/admin?notice=' + notice, request.url));
  response.cookies.set(OAUTH_COOKIE, '', { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/google', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
