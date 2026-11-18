# Orinimo · Disney OTP

Versi 2 — Next.js + React dalam **JavaScript**, Supabase PostgreSQL, dan Gmail API. Siap dibangun sebagai proyek Next.js di Vercel.

## Mulai dari sini

Proyek ini sudah berisi source aplikasi lengkap, aset Orinimo, migrasi SQL, dan pengujian. Tidak perlu menjalankan create-next-app.

Kode baru belum dipasang ke situs produksi dan belum tersambung ke tiga Gmail asli. Berkas konfigurasi pada ZIP sumber berisi placeholder, bukan kredensial yang dapat digunakan. Pemetaan nomor ke akun dan token berada di Supabase, bukan ditulis langsung di source ZIP.

1. Ekstrak ZIP dan buka folder **orinimo-otp** di VS Code.
2. Gunakan Node.js 24 LTS (minimal Node.js 22).
3. Jalankan:

~~~bash
npm ci
cp .env.example .env.local
npm run dev
~~~

Halaman login lokal: http://localhost:3000/login.

Untuk melihat tampilan dan menguji status tanpa kredensial, buka http://localhost:3000/demo. Halaman ini memakai kode simulasi dan hanya berjalan dalam development lokal. Halaman /demo memberikan 404 pada build produksi atau Vercel. API asli tetap memerlukan login admin; mode demo tidak memberikan akses Gmail.

Jangan menggunakan nama berkas `.env .local` (ada spasi). Nama yang benar adalah **.env.local**.

## Pilihan stack

| Bagian | Pilihan | Alasan |
| --- | --- | --- |
| UI | React + JavaScript/JSX | Sesuai bahasa yang dikuasai; seluruh source aplikasi berupa JS/JSX. |
| Aplikasi dan API | Next.js App Router | UI, login, server actions, dan API berada dalam satu deployment Vercel. |
| Database dan login admin | Supabase PostgreSQL + Supabase Auth | Mempertahankan akun, ID, dan token dari proyek lama. |
| Integrasi email | Gmail REST API melalui fetch server | Tidak memuat SDK googleapis yang mencakup banyak layanan lain. |
| Tampilan | CSS + font Nunito lokal + WebP | Tanpa Font Awesome/CDN font, framework animasi, atau UI kit besar. |

Express atau MySQL tambahan tidak diperlukan untuk kebutuhan aplikasi ini. Konversi TypeScript ke JavaScript memudahkan pemeliharaan; konversi itu sendiri bukan penyebab peningkatan kecepatan runtime.

## 1. Migrasi Supabase yang sudah ada

Gunakan **proyek Supabase lama** agar ketiga akun dan koneksinya tetap tersedia.

Jalankan isi:

**supabase/migrations/001_reliable_otp.sql**

di SQL Editor Supabase. Migrasi ini menambah kolom dan fungsi tanpa menghapus akun, token, atau riwayat OTP lama. Skrip juga dapat digunakan pada database baru dan dapat dijalankan ulang.

Yang ditambahkan:

- Email Disney yang diharapkan untuk setiap nomor.
- Alamat Gmail yang benar-benar terhubung dan versi koneksinya.
- Pengunci pemeriksaan per akun dan jeda 5 detik yang berlaku lintas instance Vercel.
- Metadata pemeriksaan terakhir, tanpa menyimpan ulang kode atau isi email.

Kolom email baru sengaja tidak diisi dengan tebakan. Setelah aplikasi berjalan, lengkapi email ketiga akun di **Kelola akun**.

## 2. Environment

Isi variabel berikut di .env.local untuk lokal dan pada Environment Variables Vercel untuk deployment.

| Variabel | Isi |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | URL proyek Supabase lama. |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Anon key atau publishable key proyek. Nama variabel lama dipertahankan. |
| SUPABASE_SERVICE_ROLE_KEY | Service-role key atau secret key, hanya untuk server. |
| GOOGLE_CLIENT_ID | Client ID OAuth Google untuk aplikasi web. |
| GOOGLE_CLIENT_SECRET | Client secret OAuth Google. |
| GOOGLE_REDIRECT_URI | Lokal: http://localhost:3000/api/google/callback. Produksi: https://otp-disney.vercel.app/api/google/callback. |
| ADMIN_EMAILS | Email akun **Supabase Auth** yang boleh masuk sebagai admin. Boleh beberapa email dipisahkan koma. |
| OAUTH_STATE_SECRET | Nilai acak minimal 32 karakter untuk menandatangani sesi koneksi Google. |
| DISNEY_OTP_SENDERS | Default: disneyplus@trx.mail2.disneyplus.com. |

Email admin Supabase boleh berbeda dari ketiga email Disney. ADMIN_EMAILS tidak mengatur penerima OTP; penerima OTP diatur per kartu akun di halaman admin.

Buat OAUTH_STATE_SECRET di terminal:

~~~bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
~~~

Simpan hasilnya sebagai nilai environment. Jangan menyalin kredensial ke source atau Git. Akun dengan app_metadata.role = admin juga diizinkan; user_metadata tidak digunakan untuk memberikan hak admin.

## 3. Hubungkan dan periksa ketiga akun

Pastikan Gmail API aktif pada proyek Google Cloud yang memiliki OAuth Client ID tersebut. Tambahkan redirect URI lokal/produksi yang sama persis dengan environment. Jika aplikasi OAuth masih membatasi pengguna pengujian, tambahkan ketiga alamat Gmail sebagai pengguna yang diizinkan.

1. Masuk lewat /login menggunakan akun admin Supabase.
2. Buka **Kelola akun** (/admin).
3. Akun lama muncul berdasarkan data Supabase; tidak perlu menambahkan tiga akun yang sama lagi.
4. Periksa **nomor**, **nama akun**, dan **email Disney** pada masing-masing kartu.
5. Isi email Disney yang benar, lalu klik **Simpan**.
6. Klik **Hubungkan Gmail** atau **Hubungkan ulang Gmail**, lalu pilih Gmail akun tersebut.
7. Setelah kembali, periksa alamat **Gmail yang terhubung** dan label **Email sesuai**.
8. Ulangi untuk ketiga akun.

| Pemetaan | Tempat penyimpanan |
| --- | --- |
| Nomor → akun | otp_accounts.phone_number → otp_accounts.id |
| Akun → email penerima Disney | otp_accounts.disney_email |
| Akun → koneksi OAuth Gmail | gmail_tokens.otp_account_id |
| Identitas Gmail yang terhubung | gmail_tokens.gmail_email |

Koneksi lama yang masih valid dapat diverifikasi otomatis melalui Gmail profile saat pemeriksaan pertama, setelah email Disney dilengkapi. Hubungkan ulang jika koneksi tidak cocok atau Google meminta otorisasi ulang.

Aplikasi memeriksa alamat penerima pada header To/Cc, bukan cuplikan percakapan Gmail. Alias Gmail dapat mengidentifikasi mailbox yang sama, tetapi alamat penerima OTP tetap dibandingkan secara tepat agar dua akun dengan +alias tidak tercampur.

Nomor 08 dan +62 dikenali sebagai variasi Indonesia. Nomor dengan kode negara lain tetap didukung. Jika database lama mengandung dua baris ambigu untuk variasi nomor yang sama, aplikasi menolak memilih akun secara acak; perbaiki duplikasi di admin.

## 4. Deploy ke Vercel

Gunakan isi folder orinimo-otp sebagai root proyek atau set Root Directory ke folder tersebut.

| Pengaturan | Nilai |
| --- | --- |
| Framework Preset | Next.js |
| Node.js | 24.x |
| Install Command | npm ci |
| Build Command | npm run build |
| Output Directory | Biarkan pengaturan otomatis Next.js. |

Jika mengganti repository lama, kerjakan di branch terlebih dahulu. Ganti source lama dengan source paket ini; jangan menumpuk route .tsx/.ts lama dan .jsx/.js baru yang memiliki nama sama. Simpan environment lama di tempat aman, lalu isikan ke Vercel.

Jalankan migrasi SQL, tambahkan semua environment, periksa Google Redirect URI, lalu deploy. Jika domain berubah, ubah GOOGLE_REDIRECT_URI dan Authorized redirect URI di Google Cloud secara bersamaan. Redeploy setelah mengubah environment.

Tidak perlu membuat server Express, cron, polling server permanen, atau realtime subscription Supabase. Polling dilakukan dari halaman aktif, dengan jeda serta pengunci database di server.

## 5. Cara memakai

1. Minta OTP dari halaman/aplikasi Disney+.
2. Masukkan nomor yang terdaftar di Orinimo.
3. Klik **Ambil kode OTP**.
4. Jika email belum tiba, aktifkan **Cek otomatis**.
5. Klik **Salin kode**, lalu tempel ke Disney+.

Kode menampilkan waktu penerimaan dalam WITA dan sisa masa berlaku. Kode lama tidak ditampilkan sebagai fallback saat ada kegagalan. Saat nomor diubah, permintaan sebelumnya dibatalkan dan hasilnya tidak boleh mengisi akun yang baru.

Pemeriksaan otomatis berjeda 5 detik setelah respons normal, berhenti saat tab tidak aktif atau offline, dan dijeda setelah 2 menit atau tiga kegagalan beruntun. Aktifkan kembali atau klik tombol pencarian untuk melanjutkan.

## 6. Verifikasi

~~~bash
npm test
npm run build
~~~

Pengujian mencakup parser, transport Gmail dengan HTTP mock, orkestrasi OTP, HTTP authorization, OAuth state/PKCE, dan migrasi/pengunci SQL pada PostgreSQL berbasis PGlite. Tidak ada email asli atau kode aktif yang digunakan dalam tes.

Baca **HASIL_PEMERIKSAAN.md** untuk hasil dan batas verifikasi.

Uji penerimaan produksi setelah konfigurasi:

- Pada akun 1, 2, dan 3: minta OTP dari Disney+, cocokkan kode dan waktu dengan **email paling baru yang dibuka penuh** di Gmail.
- Minta kode kedua; pastikan kode baru menggantikan kode pertama.
- Jika belum ada email baru, status harus menyebut **Masih kode yang sama**, bukan seolah ada kode baru.
- Coba nomor yang tidak terdaftar dan alamat Gmail yang keliru; aplikasi harus menolak tanpa menampilkan OTP akun lain.
- Buka dua tab untuk akun yang sama; permintaan bersamaan harus mendapat jeda.
- Pastikan /api/otp menolak permintaan tanpa sesi admin dan /demo tidak tersedia pada produksi.

## Batas yang perlu dipahami

Orinimo membaca email yang **sudah diterima Gmail**. Aplikasi tidak mengirim OTP Disney dan tidak dapat mempercepat pengiriman email dari Disney atau menjamin kapan Gmail mengindeks email.

Enam digit dan masa berlaku 15 menit mengikuti ketiga contoh email yang diberikan. Tes memakai rekonstruksi isi contoh, bukan file .eml asli. Jika format atau pengirim email berubah, parser/daftar pengirim perlu disesuaikan berdasarkan contoh aktual.

Jika dua orang meminta kode untuk **akun Disney yang sama** bersamaan, email tidak menyediakan identitas sesi login untuk membedakan permintaan mereka. Sistem memilih email terbaru yang cocok untuk akun tersebut. Hindari permintaan bersamaan pada akun yang sama jika kode saling menggantikan.

Mailbox harus merupakan mailbox Gmail dari email Disney yang dikonfigurasi. Pengalihan email dari mailbox berbeda tidak diasumsikan otomatis aman. Hasil ambigu, lebih dari 25 kandidat email dalam jendela pencarian, atau badan email yang gagal diambil ditolak tanpa menampilkan kode lebih lama.

Hak akses mengikuti situs live yang saat diperiksa mengarahkan pengunjung ke login: pemeriksaan OTP dan pengelolaan akun hanya tersedia bagi admin yang diizinkan.

## Berkas utama

| Berkas | Tanggung jawab |
| --- | --- |
| lib/otp-parser.js | Baca MIME, validasi pengirim/penerima/subjek, pilih email terbaru, ekstrak enam digit. |
| lib/google.js | OAuth, token refresh, Gmail profile, pencarian dan pengambilan email. |
| lib/otp-service.js | Alur pemeriksaan, pengunci akun, kedaluwarsa, penolakan koneksi berubah. |
| lib/otp-repository.js | Akses Supabase dan RPC pengunci. |
| components/useOtp.js | Pembatalan permintaan lama dan polling yang tidak bertumpuk. |
| components/OtpApp.jsx | Tampilan dan interaksi pengambilan OTP. |
| components/LoginScreen.jsx | Tampilan login popcorn. |
| app/admin/ | Pemetaan nomor/email dan pengelolaan koneksi Gmail. |
| supabase/migrations/001_reliable_otp.sql | Migrasi database lama dan database baru. |

## Referensi teknis

- [Gmail message resource dan internalDate](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Gmail search/filtering dan timestamp epoch](https://developers.google.com/workspace/gmail/api/guides/filtering)
- [Google OAuth untuk aplikasi web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

Commit message yang bisa digunakan:

~~~text
fix: make Disney OTP retrieval reliable and redesign Orinimo in JavaScript
~~~
