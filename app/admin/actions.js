'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canonicalPhone, phoneVariants } from '@/lib/phone';
import { normalizeEmail, validEmail } from '@/lib/otp-parser';

export async function saveAccount(formData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  const phone = canonicalPhone(String(formData.get('phone_number') || ''));
  const email = normalizeEmail(String(formData.get('disney_email') || ''));
  const label = String(formData.get('label') || '').trim().slice(0, 80);
  if (!phone || !validEmail(email) || (id && !/^[a-f\d-]{36}$/i.test(id))) redirect('/admin?notice=invalid');
  let ok = false;
  try {
    const db = createSupabaseAdmin();
    // Reject ambiguous 08/+62 variants before changing an existing mapping.
    const { data: existing, error: lookupError } = await db.from('otp_accounts').select('id').in('phone_number', phoneVariants(phone));
    if (lookupError || existing?.some((row) => row.id !== id)) throw new Error('duplicate');
    const values = { phone_number: phone, disney_email: email, label, service: 'disney', is_active: id ? formData.get('is_active') === 'on' : true };
    const result = id ? await db.from('otp_accounts').update(values).eq('id', id).eq('service', 'disney').select('id') :
      await db.from('otp_accounts').insert(values).select('id');
    ok = !result.error && result.data?.length === 1;
  } catch { /* Notice does not expose database internals. */ }
  revalidatePath('/admin');
  redirect('/admin?notice=' + (ok ? 'saved' : 'save_failed'));
}

export async function signOut() {
  const db = await createSupabaseServerClient();
  await db.auth.signOut();
  redirect('/login');
}
