# Orinimo · Disney OTP

Orinimo membantu admin menemukan kode dari email Disney+ terbaru untuk akun yang dipilih. Aplikasi menggunakan Next.js App Router, React dengan JavaScript, Supabase PostgreSQL, Supabase Auth, dan Gmail API.

## Menjalankan proyek

Buka folder yang berisi `package.json`. Proyek mendukung Node.js 22 ke atas. Konfigurasi deployment menggunakan Node.js 24.x.

Untuk pemasangan pertama, jalankan:

```bash
npm ci
```

Buat `.env.local` dari `.env.example` jika `.env.local` belum tersedia. Isi nilainya untuk proyek lokal, lalu jalankan:

```bash
npm run dev
```

- Halaman login lokal tersedia di `http://localhost:3000/login`.
- Pratinjau dengan data simulasi tersedia di `http://localhost:3000/demo` saat development.
- Halaman admin tersedia di `/admin`.
- Akun untuk login ke Orinimo menggunakan Supabase Auth. Koneksi ke Gmail dilakukan terpisah dari halaman admin.

## Database Supabase

Gunakan proyek Supabase aktif yang dipakai oleh deployment Orinimo. Untuk database kosong, jalankan seluruh isi `supabase/migrations/001_reliable_otp.sql` di SQL Editor Supabase. Jika skema v2 sudah terpasang, pembaruan parser ini cukup diterapkan melalui file aplikasi.

| Data | Lokasi |
| --- | --- |
| Nomor terdaftar | `otp_accounts.phone_number` |
| Identitas akun | `otp_accounts.id` |
| Email penerima Disney+ | `otp_accounts.disney_email` |
| Relasi koneksi Gmail | `gmail_tokens.otp_account_id` |
| Alamat kotak Gmail terhubung | `gmail_tokens.gmail_email` |

Pengunci per akun mencegah dua permintaan bersamaan membaca akun yang sama. Database mencatat status pemeriksaan, ID pesan, dan waktu penerimaan. Aplikasi membaca kode dari isi email saat diperlukan.

## Variabel environment

Gunakan nilai dari proyek Supabase aktif dan OAuth Client Google milik aplikasi. Simpan nilai lokal di `.env.local` dan nilai produksi di Environment Variables pada proyek Vercel.

| Variabel | Isi |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL proyek Supabase aktif |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key atau anon key proyek |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key atau service-role key proyek, khusus server |
| `GOOGLE_CLIENT_ID` | Client ID Google OAuth untuk aplikasi web |
| `GOOGLE_CLIENT_SECRET` | Client secret dari OAuth Client yang sama |
| `GOOGLE_REDIRECT_URI` | URL callback di deployment yang dipakai |
| `ADMIN_EMAILS` | Alamat login admin Supabase Auth, dipisahkan koma jika lebih dari satu |
| `OAUTH_STATE_SECRET` | Nilai acak minimal 32 karakter untuk sesi koneksi Google |
| `DISNEY_OTP_SENDERS` | Opsional. Pengirim bawaan adalah `disneyplus@trx.mail2.disneyplus.com` |

Untuk membuat `OAUTH_STATE_SECRET` saat menyiapkan proyek pertama kali:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Contoh callback lokal adalah `http://localhost:3000/api/google/callback`. Untuk produksi, gunakan domain produksi yang membuka Orinimo, diikuti `/api/google/callback`. Daftarkan alamat lengkap yang sama pada Authorized redirect URIs di Google Cloud.

## Menghubungkan akun Disney dan Gmail

1. Masuk ke `/login` dengan akun admin Supabase.
2. Buka **Kelola akun**.
3. Pilih kartu akun yang ingin diatur.
4. Periksa nama akun dan nomor terdaftar.
5. Di Gmail, buka pesan Disney+ dan klik panah detail di bawah nama pengirim. Salin alamat lengkap pada **To/Kepada** ke kolom **Email Disney**, termasuk titik dan tanda tambah. Klik **Simpan**.
6. Untuk koneksi pertama, klik **Hubungkan Gmail** dan pilih Gmail yang menerima email tersebut. Gunakan **Hubungkan ulang Gmail** jika kotak masuk berubah atau Google meminta izin kembali.
7. Periksa alamat **Gmail yang terhubung** dan label **Kotak Gmail sesuai**.
8. Ulangi untuk setiap akun.

Label **Kotak Gmail sesuai** menunjukkan identitas kotak masuk yang terhubung. Saat mencari pesan, aplikasi juga membandingkan alamat penerima di email dengan `disney_email` milik akun yang dipilih.

## Menggunakan Orinimo

1. Minta kode dari Disney+.
2. Masukkan nomor terdaftar di Orinimo.
3. Klik **Ambil kode OTP**.
4. Setelah ditemukan, cocokkan waktu penerimaan yang ditampilkan dalam WITA.
5. Klik **Salin kode** dan masukkan kodenya ke Disney+.

Pemeriksaan otomatis dimulai setelah pencarian. Jeda normalnya lima detik. Pemeriksaan dijeda saat tab tidak aktif atau perangkat offline, dan dibatasi sekitar dua menit per sesi pencarian.

## Membaca hasil pencarian

| Hasil | Arti dan tindakan |
| --- | --- |
| Kode siap dipakai | Aplikasi menemukan satu kode pada email terbaru yang memenuhi pemeriksaan. |
| Masih kode yang sama | ID pesan sama dengan hasil pemeriksaan sebelumnya. |
| Belum menemukan email yang cocok | Baca keterangan di bawah status untuk melihat apakah hasil kosong, subjek tidak dikenali, atau alamat penerima berbeda. |
| Periksa ejaan email Disney | Cocokkan ejaan pada kolom To/Kepada dengan Email Disney di kartu akun. |
| Kode belum bisa dibaca | Periksa keterangan dan jam penerimaan. Buka pesan dengan jam tersebut di Gmail. |
| Kodenya sudah kedaluwarsa | Minta kode baru dari Disney+. |
| Gmail perlu dihubungkan ulang | Buka Kelola akun dan izinkan kembali koneksi Gmail yang sesuai. |

Parser membaca isi tiap pesan Gmail, memeriksa pengirim, subjek, penerima, dan waktu penerimaan, lalu memproses pesan terbaru. Format Indonesia dan Inggris didukung. Kode disimpan sebagai teks selama permintaan agar angka nol di depan tetap terbaca. Jika teks dan HTML memberikan angka yang bertentangan, aplikasi mengembalikan status pemeriksaan.

Masa berlaku 15 menit mengikuti contoh email Disney+ yang digunakan untuk proyek ini. Jika dua permintaan login menggunakan satu akun Disney pada saat yang sama, Orinimo hanya dapat mengenali email terbaru yang cocok untuk akun itu.

## Deployment Vercel

| Pengaturan | Nilai |
| --- | --- |
| Root Directory | Folder yang berisi `package.json` Orinimo |
| Framework Preset | Next.js |
| Node.js | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Otomatis |

Pastikan environment produksi menunjuk proyek Supabase aktif. Setelah memperbarui environment, lakukan deployment baru agar nilai tersebut digunakan.

## Pengujian

```bash
npm test
npm run build
```

Tes menggunakan contoh email, respons Gmail simulasi, dan database pengujian lokal. Pengujian mencakup pemilihan pesan terbaru, template Indonesia dan Inggris, masa berlaku, variasi alamat, isi pesan terpisah, koneksi akun, dan autentikasi API.

Untuk memeriksa deployment, minta satu kode baru pada satu akun, buka pesan terbarunya di Gmail, dan cocokkan waktu serta kode dengan hasil Orinimo. Ulangi pada masing-masing akun yang terdaftar.