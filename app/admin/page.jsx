import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { mailboxIdentity } from '@/lib/otp-parser';
import { Header, Footer } from '@/components/Brand';
import Icon from '@/components/Icon';
import SaveButton from '@/components/SaveButton';
import { saveAccount, signOut } from './actions';

export const dynamic = 'force-dynamic';

const notices = {
  connected: 'Gmail berhasil terhubung ke akun yang sesuai. Sekarang coba ambil OTP.',
  saved: 'Pengaturan akun berhasil disimpan.',
  wrong_email: 'Gmail yang dipilih tidak sesuai email Disney akun ini. Hubungkan kembali dengan Gmail yang benar.',
  connect_failed: 'Gmail belum berhasil terhubung. Periksa konfigurasi OAuth, redirect URI, dan email Disney.',
  refresh_missing: 'Google belum memberikan izin akses berkelanjutan. Hubungkan ulang dan izinkan akses Gmail.',
  invalid: 'Periksa nomor dan alamat email. Semua akun harus punya email Disney yang jelas.',
  save_failed: 'Akun belum tersimpan. Pastikan nomor belum digunakan dan migrasi database sudah dijalankan.',
};

export default async function AdminPage({ searchParams }) {
  if (!await getAdminUser()) redirect('/login');

  const params = await searchParams;
  let accounts = [];
  let error = false;

  try {
    const db = createSupabaseAdmin();
    const response = await db
      .from('otp_accounts')
      .select('id,phone_number,label,is_active,disney_email,last_status,gmail_tokens(gmail_email,otp_account_id)')
      .eq('service', 'disney')
      .order('created_at');

    error = Boolean(response.error);
    accounts = response.data || [];
  } catch {
    error = true;
  }

  return (
    <div className="site-shell">
      <Header />

      <main id="main" className="admin-main">
        <div className="admin-title-row">
          <div>
            <span className="eyebrow">BEHIND THE POPCORN</span>
            <h1>Rumah untuk akunmu.</h1>
            <p>Pastikan setiap nomor terhubung ke email Disney dan Gmail yang tepat.</p>
          </div>

          <form action={signOut}>
            <button className="outline-button"><Icon name="logout" size={16} />Keluar</button>
          </form>
        </div>

        {notices[params.notice] && (
          <p
            role="status"
            className={'notice' + (['saved', 'connected'].includes(params.notice) ? ' success' : '')}
          >
            {notices[params.notice]}
          </p>
        )}

        {error && (
          <p role="alert" className="notice">
            Data akun belum dapat dibaca. Periksa environment dan jalankan migrasi
            001_reliable_otp.sql terlebih dahulu.
          </p>
        )}

        <div className="admin-grid">
          {accounts.map((account, index) => {
            const token = Array.isArray(account.gmail_tokens)
              ? account.gmail_tokens[0]
              : account.gmail_tokens;

            const verified = token?.gmail_email && account.disney_email &&
              mailboxIdentity(token.gmail_email) === mailboxIdentity(account.disney_email);

            return (
              <article className="account-card" key={account.id}>
                <div className="ticket-stripe" />

                <div className="account-card-body">
                  <div className="account-topline">
                    <span className="account-count">
                      ACCOUNT {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className={'connection-status' + (verified ? ' connected' : '')}>
                      {verified ? 'Kotak Gmail sesuai' : token ? 'Perlu diperiksa' : 'Belum terhubung'}
                    </span>
                  </div>

                  <h2>{account.label || 'Akun Disney+'}</h2>

                  <form action={saveAccount} className="main-form">
                    <input type="hidden" name="id" value={account.id} />

                    <label htmlFor={'label-' + account.id}>Nama akun</label>
                    <div className="input-wrap">
                      <input
                        id={'label-' + account.id}
                        name="label"
                        defaultValue={account.label || ''}
                        maxLength={80}
                      />
                    </div>

                    <label htmlFor={'phone-' + account.id}>Nomor terdaftar</label>
                    <div className="input-wrap">
                      <input
                        id={'phone-' + account.id}
                        name="phone_number"
                        type="tel"
                        defaultValue={account.phone_number}
                        maxLength={40}
                        required
                      />
                    </div>

                    <label htmlFor={'email-' + account.id}>Email Disney</label>
                    <div className="input-wrap">
                      <input
                        id={'email-' + account.id}
                        name="disney_email"
                        type="email"
                        defaultValue={account.disney_email || ''}
                        placeholder="Email penerima OTP Disney"
                        maxLength={254}
                        required
                      />
                    </div>

                    <div className="account-actions">
                      <label>
                        <input type="checkbox" name="is_active" defaultChecked={account.is_active} />
                        Akun aktif
                      </label>
                      <SaveButton />
                    </div>
                  </form>

                  <div className="connection-info">
                    Gmail yang terhubung
                    <strong>
                      {token?.gmail_email || (token ? 'Koneksi lama · email belum diverifikasi' : 'Belum ada Gmail')}
                    </strong>

                    {account.disney_email ? (
                      <a href={'/api/google/connect?account=' + account.id}>
                        {token ? 'Hubungkan ulang Gmail' : 'Hubungkan Gmail'}
                        <Icon name="arrow" size={13} />
                      </a>
                    ) : (
                      <span>Simpan email Disney terlebih dahulu.</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {!error && accounts.length === 0 && (
          <div className="empty-admin">
            <img src="/brand/thinking.webp" width="120" height="120" alt="" />
            <p>Belum ada akun. Tambahkan akun pertamamu di bawah ini.</p>
          </div>
        )}

        <section className="add-account">
          <h2>Tambah teman movie night.</h2>
          <p>Satu nomor, satu email Disney, satu koneksi Gmail.</p>

          <form className="main-form" action={saveAccount}>
            <div>
              <label htmlFor="new-label">Nama akun</label>
              <div className="input-wrap">
                <input id="new-label" name="label" placeholder="Contoh: Disney 01" maxLength={80} />
              </div>
            </div>

            <div>
              <label htmlFor="new-phone">Nomor terdaftar</label>
              <div className="input-wrap">
                <input
                  id="new-phone"
                  name="phone_number"
                  type="tel"
                  placeholder="08 / +62 / kode negara lain"
                  required
                  maxLength={40}
                />
              </div>
            </div>

            <div>
              <label htmlFor="new-email">Email Disney</label>
              <div className="input-wrap">
                <input
                  id="new-email"
                  name="disney_email"
                  type="email"
                  placeholder="nama@gmail.com"
                  required
                  maxLength={254}
                />
              </div>
            </div>

            <SaveButton>Tambah akun</SaveButton>
          </form>
        </section>

        <p className="admin-help">
          Isi Email Disney sesuai kolom To (Kepada) di detail email Disney+, termasuk titik
          dan tanda tambah. Simpan alamat untuk nomor tersebut. Hubungkan ulang Gmail jika
          akun kotak masuknya berubah.
        </p>

        <p className="admin-help">
          <a className="outline-button" href="/">
            <Icon name="play" size={15} />Kembali ambil OTP
          </a>
        </p>
      </main>

      <Footer />
    </div>
  );
}