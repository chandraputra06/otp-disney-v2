'use server';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient, isConfigured } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/admin-policy';

export async function loginAction(_previous, formData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  if (!email || !password) return { error: 'Isi email dan kata sandimu dulu, ya.' };
  if (!isConfigured()) return { error: 'Konfigurasi server belum lengkap. Isi environment Supabase sesuai panduan proyek.' };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: 'Email atau kata sandi belum cocok. Coba periksa kembali.' };
    if (!isAdminUser(data.user)) {
      await supabase.auth.signOut();
      return { error: 'Akun ini belum memiliki akses Orinimo. Hubungi admin.' };
    }
  } catch { return { error: 'Belum bisa terhubung. Coba lagi sebentar.' }; }
  redirect('/');
}
