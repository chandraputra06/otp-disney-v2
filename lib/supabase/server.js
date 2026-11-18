import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function isConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function createSupabaseServerClient() {
  if (!isConfigured()) throw new Error('configuration_error');
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(6_000) }) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(items) {
        try { for (const { name, value, options } of items) jar.set(name, value, options); }
        catch { /* Read-only Server Component; proxy refreshes the session. */ }
      },
    },
  });
}
