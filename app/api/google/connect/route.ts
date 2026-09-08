import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/gmail';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const accountId = req.nextUrl.searchParams.get('account');
  if (!accountId) {
    return NextResponse.json({ message: 'Parameter "account" wajib diisi.' }, { status: 400 });
  }

  return NextResponse.redirect(getAuthUrl(accountId));
}