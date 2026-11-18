# Hasil pemeriksaan Orinimo OTP v2

## Dasar pemeriksaan

Source berasal dari ZIP yang dilampirkan. Situs https://otp-disney.vercel.app/ mengarahkan ke /login ketika dibuka; area yang membutuhkan sesi admin tidak diakses. Karena itu, temuan source tidak mengasumsikan bahwa ZIP identik dengan seluruh kode produksi.

Referensi tampilan Dudio berhasil dilihat: tampilan login bergaya playful dengan karakter, latar dekoratif, dan tombol yang tegas. Implementasi Orinimo menggunakan identitas popcorn sendiri dengan krem, merah, kuning, tiket bioskop, dan aset yang disediakan.

Tidak ditemukan tiga alamat email atau tiga tautan akun yang ditulis langsung dalam source. Hubungan yang tersedia adalah otp_accounts.id → gmail_tokens.otp_account_id pada database. Kredensial dalam arsip masih placeholder, sehingga baris database sebenarnya tidak dapat dibaca atau dipastikan.

## Masalah pada source lama dan perbaikannya

| Temuan source lama | Dampak yang mungkin terjadi | Perbaikan |
| --- | --- | --- |
| Query mencari Disney OR kode OR OTP selama dua hari | Email layanan lain bisa ikut terpilih. | Pengirim tepat, jendela waktu terbatas, dan pemeriksaan subjek/penerima. |
| Regex mengambil angka pertama 4–6 digit dari gabungan subject/snippet/body | Tahun, cuplikan pesan lama, atau angka lain bisa dianggap OTP. | Enam digit dari badan MIME; tidak mengambil kode dari snippet. |
| Email dikembalikan saat pertama memiliki angka | Email lama bisa dipakai saat email baru tidak terbaca. | Kandidat diurutkan berdasarkan internalDate; email terbaru yang ambigu/gagal dibaca tidak diganti dengan email lama. |
| Cache sukses selama 12 detik | Kode baru di Gmail dapat tertutup cache lama. | Tidak ada cache kode sukses lintas permintaan. |
| last_otp_code ditampilkan saat error | Kode kedaluwarsa dapat terlihat sebagai hasil yang bisa digunakan. | Tidak ada fallback kode lama; tanggal kedaluwarsa diperiksa server dan UI. |
| Pengambilan body email satu per satu | Waktu tunggu bertambah tiap panggilan. | Maksimal lima pengambilan paralel dengan satu tenggat Gmail. |
| Jeda tidak diklaim secara atomik | Permintaan antar-tab/instance bisa bertumpuk. | Fungsi PostgreSQL dengan row lock dan lease per akun. |
| Polling bisa tumpang tindih dan hasil lama bisa menimpa nomor baru | Tampilan dapat menampilkan hasil dari permintaan sebelumnya. | AbortController, penanda generasi permintaan, dan penjadwalan setelah respons selesai. |
| OAuth state hanya ID akun | Callback tidak terikat secara kuat ke sesi koneksi. | Nonce, cookie HttpOnly bertanda tangan, masa berlaku, pengikatan user, dan PKCE. |
| Admin action tidak memeriksa izin sendiri | Perlindungan halaman saja tidak cukup untuk mutation. | Pengecekan admin pada action, endpoint OTP, dan alur Google. |
| package.json tidak memiliki scripts maupun dependency Next/React | Paket belum bisa langsung build sebagai proyek lengkap. | Manifest, lockfile, dev/build/start/test lengkap. |

## Hasil tes

- **49 pengujian otomatis lulus, 0 gagal.**
- **Build produksi Next.js berhasil.**
- Seluruh source aplikasi JavaScript/JSX; tidak ada source TypeScript.
- Parser: contoh Inggris 129534, Indonesia 703401/917309, leading zero, HTML, kode yang terpisah sel tabel, angka tahun, snippet lama, attachment, penerima/pengirim salah, timestamp, ambiguitas, dan batas 15 menit.
- Gmail mock: query, pembacaan paralel, refresh token, 401 retry, invalid_grant, pemeriksaan mailbox lama, kandidat terpotong, dan kegagalan pembacaan.
- Layanan/API: nomor internasional, ambiguitas 08/+62, penerima belum disetel, cooldown, message ID, pergantian koneksi, auth, origin, input, Retry-After, dan respons tanpa informasi internal.
- OAuth: tanda tangan state, user, nonce, masa berlaku, dan PKCE.
- PostgreSQL/PGlite: migrasi dijalankan dua kali, data lama tetap ada, satu lease per akun, penolakan lease salah, cooldown setelah selesai, perubahan penerima, dan pembatasan role.

## Pemeriksaan UI

Berhasil dilihat/dicoba di browser desktop:

- Halaman login dan halaman pengambilan OTP.
- Validasi input kosong.
- Status mencari, berhasil, menunggu email, dan koneksi gagal.
- Salin kode simulasi; isi clipboard cocok 246810.
- Jeda pemeriksaan otomatis.
- Mengubah nomor saat pencarian menghapus hasil lama.

Layout responsif dan prefers-reduced-motion telah dibuat. Pemeriksaan visual ukuran ponsel tidak selesai karena lingkungan browser menolak halaman pratinjau tertanam. Tidak ada klaim pengujian pada perangkat iPhone/Android asli.

## Ukuran aset

Kelima PNG asli berjumlah **1.726.294 byte**. Kelima WebP hasil optimasi berjumlah **212.582 byte**, sekitar **87,7% lebih kecil**. Ini pengurangan ukuran aset, bukan pengukuran waktu respons Gmail atau benchmark seluruh aplikasi.

Gambar tetap menggunakan maskot dan logo yang diberikan. Tidak ada pustaka animasi tambahan atau stylesheet ikon pihak ketiga. Font disajikan bersama aplikasi.

## Belum diverifikasi

1. Data pemetaan nomor/email yang sebenarnya di Supabase.
2. Login Supabase menggunakan akun admin milik pengguna.
3. OAuth dan token refresh pada ketiga Gmail asli.
4. Kecocokan OTP dengan email terbaru pada produksi.
5. Waktu respons di Vercel, kondisi cold start, dan jaringan pengguna.
6. Pengiriman atau penerimaan email Disney secara langsung.

Poin-poin tersebut memerlukan konfigurasi asli dan uji penerimaan setelah deploy; semuanya tercantum dalam README.

Tidak ada deployment Vercel, perubahan Supabase produksi, atau pengiriman pesan yang dilakukan dalam pengerjaan ini.
