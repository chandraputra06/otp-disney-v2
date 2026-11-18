import 'server-only';
import { createSupabaseServerClient, isConfigured } from './supabase/server.js';
import { isAdminUser } from './admin-policy.js';

export async function getAdminUser() {
  if (!isConfigured()) return null;
  const db = await createSupabaseServerClient();
  const { data: { user }, error } = await db.auth.getUser();
  return !error && isAdminUser(user) ? user : null;
}

export async function requireAdmin() {
  const user = await getAdminUser();
  if (!user) throw new Error('unauthorized');
  return user;
}
