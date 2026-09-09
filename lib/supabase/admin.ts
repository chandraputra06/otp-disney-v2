import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder-key',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}