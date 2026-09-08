import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/gmail';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const code = req.nextUrl.searchParams.get('code');
  const accountId = req.nextUrl.searchParams.get('state');
  if (!code || !accountId) {
    return NextResponse.json({ message: 'Callback tidak lengkap.' }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const admin = createSupabaseAdmin();
    await admin.from('gmail_tokens').upsert(
      {
        otp_account_id: accountId,
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      },
      { onConflict: 'otp_account_id' }
    );
    return NextResponse.redirect(new URL('/admin?connected=1', req.url));
  } catch {
    return NextResponse.redirect(new URL('/admin?connected=0', req.url));
  }
}