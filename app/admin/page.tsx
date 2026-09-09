// Halaman admin: tambah akun OTP & hubungkan Gmail. Dilindungi middleware (harus login).
import { redirect } from 'next/navigation';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const dynamic = 'force-dynamic';

async function addAccount(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone_number') ?? '').replace(/\D+/g, '');
  const label = String(formData.get('label') ?? '').trim() || null;
  if (!/^[0-9]{10,15}$/.test(phone)) return;
  const admin = createSupabaseAdmin();
  await admin.from('otp_accounts').upsert(
    { phone_number: phone, label, service: 'disney', is_active: true },
    { onConflict: 'phone_number' }
  );
  redirect('/admin');
}

async function signOut() {
  'use server';
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function AdminPage() {
  const admin = createSupabaseAdmin();
  const { data: accounts } = await admin
    .from('otp_accounts')
    .select('id, phone_number, label, is_active, gmail_tokens(otp_account_id)')
    .order('created_at', { ascending: false });

  return (
    <main className="otp-wrap">
      <div className="otp-container">
        <div className="otp-head">
          <span className="otp-pill"><span className="dot" />Admin · Orinimo</span>
          <h1>Kelola Akun OTP</h1>
        </div>

        <div className="otp-card">
          <p className="field-label">Tambah akun baru</p>
          <form action={addAccount}>
            <input className="field-input" name="phone_number" placeholder="Nomor handphone (10-15 digit)" inputMode="numeric" />
            <input className="field-input" name="label" placeholder="Keterangan (opsional)" style={{ marginTop: 8 }} />
            <button className="btn-primary" style={{ width: '100%', marginTop: 12 }} type="submit">Simpan Akun</button>
          </form>
        </div>

        <div className="otp-panel">
          <div className="otp-toprow">
            <span className="field-label" style={{ margin: 0 }}>Daftar akun</span>
            <form action={signOut}><button className="otp-toggle" title="Keluar" style={{ width: 'auto', padding: '0 12px', borderRadius: 999 }}>Keluar</button></form>
          </div>

          {(accounts ?? []).length === 0 && <p className="otp-msg">Belum ada akun.</p>}

          {(accounts ?? []).map((a: { id: string; phone_number: string; label: string | null; gmail_tokens: unknown[] }) => {
            const connected = Array.isArray(a.gmail_tokens) && a.gmail_tokens.length > 0;
            return (
              <div key={a.id} className="otp-timerow" style={{ marginTop: 10 }}>
                <span className="lbl">
                  <i className="fa-solid fa-phone" /> {a.phone_number}
                  {a.label ? ` · ${a.label}` : ''}
                </span>
                {connected ? (
                  <span className="otp-chip" style={{ background: '#dcfce7', color: '#15803d' }}>
                    <i className="fa-solid fa-circle-check" />Terhubung
                  </span>
                ) : (
                  <a className="btn-primary" style={{ minHeight: 34, fontSize: 12, padding: '0 12px' }} href={`/api/google/connect?account=${a.id}`}>
                    Hubungkan Gmail
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
