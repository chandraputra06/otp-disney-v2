
import { redirect } from 'next/navigation';

import OtpApp from '@/components/OtpApp';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export default async function HomePage() {
  const supabase =
    await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  return <OtpApp />;
}
