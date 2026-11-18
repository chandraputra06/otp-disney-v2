import { randomUUID } from 'node:crypto';
import { phoneVariants } from './phone.js';

const messages = {
  success: ['Kode siap dipakai!', 'Salin kode ini, lalu kembali ke Disney+.'],
  unchanged: ['Masih kode yang sama', 'Belum ada email baru. Ini kode terbaru yang masih berlaku.'],
  not_found: ['Belum menemukan email yang cocok', 'Periksa kembali setelah meminta kode dari Disney+.'],
  recipient_spelling: ['Periksa ejaan email Disney', 'Ada email kode untuk ejaan lain pada Gmail ini. Buka detail email di Gmail, lalu salin alamat To (Kepada) ke kolom Email Disney di Kelola akun.'],
  expired: ['Kodenya sudah kedaluwarsa', 'Minta kode baru di Disney+, lalu cek kembali di sini.'],
  parse_failed: ['Kode belum bisa dibaca', 'Email terbaru ditemukan, tetapi kodenya belum bisa dipastikan. Buka isi pesan terbaru di Gmail.'],
  cooldown: ['Tunggu sebentar, ya', 'Pemeriksaan berikutnya akan berjalan setelah jeda selesai.'],
  account_not_found: ['Nomor belum tersedia', 'Periksa nomor yang kamu masukkan atau hubungi admin Orinimo.'],
  account_ambiguous: ['Nomor perlu diperiksa', 'Admin perlu memperbaiki dua akun dengan nomor yang sama.'],
  setup_required: ['Akun belum siap', 'Admin perlu melengkapi email Disney dan menghubungkan Gmail akun ini.'],
  reconnect_required: ['Gmail perlu dihubungkan ulang', 'Buka Kelola akun untuk menghubungkan ulang Gmail yang sesuai.'],
  account_mismatch: ['Email belum sesuai', 'Email Gmail yang terhubung berbeda dengan akun Disney. Periksa di Kelola akun.'],
  fetch_error: ['Belum berhasil terhubung', 'Koneksi ke email sedang bermasalah. Coba lagi sebentar.'],
  connection_changed: ['Akun baru saja berubah', 'Pengaturan akun berubah saat diperiksa. Silakan cek kembali.'],
};

const searchMessages = {
  empty: 'Gmail belum menampilkan pesan dari pengirim yang dikonfigurasi dalam 16 menit terakhir. Jika pesan sudah terlihat di Gmail, cocokkan alamat From dengan pengaturan DISNEY_OTP_SENDERS.',
  sender: 'Alamat From pada hasil Gmail berbeda dari pengirim Disney yang dikonfigurasi. Periksa detail pengirim di Gmail.',
  subject: 'Ada pesan dari pengirim Disney, tetapi judulnya belum dikenali sebagai email kode masuk. Periksa subjek pesan terbaru di Gmail.',
  recipient: 'Ada email kode Disney+, tetapi alamat penerimanya tidak cocok dengan Email Disney untuk nomor ini. Periksa kolom To (Kepada) di detail email.',
};

const parseMessages = {
  format: 'Email terbaru ditemukan, tetapi susunan enam digitnya belum dikenali. Buka isi pesan terbaru di Gmail.',
  ambiguous: 'Email terbaru tidak menghasilkan satu kode yang pasti. Buka isi pesan terbaru di Gmail untuk memeriksanya.',
  body_unavailable: 'Gmail mengembalikan detail email terbaru, tetapi isi teksnya belum tersedia lengkap.',
  timestamp: 'Waktu penerimaan email dari Gmail belum dapat dipastikan. Periksa waktu pada detail pesan.',
};

export function otpResult(status, extra = {}) {
  const [status_label, message] = messages[status] || messages.fetch_error;

  const description =
    (status === 'not_found' && searchMessages[extra.search_detail]) ||
    (status === 'parse_failed' && parseMessages[extra.parse_detail]) ||
    message;

  return {
    otp_code: null,
    received_at: null,
    expires_at: null,
    message_id: null,
    retry_after: 5,
    ...extra,
    status,
    status_label,
    message: description,
  };
}

export async function fetchOtpForPhone(phone, {
  previousMessageId = null,
  repo,
  readGmail,
  clock = Date.now,
}) {
  const variants = phoneVariants(phone);
  if (!variants.length) return otpResult('account_not_found');

  const accounts = await repo.findAccounts(variants);
  if (!accounts.length) return otpResult('account_not_found');
  if (accounts.length !== 1) return otpResult('account_ambiguous');

  const account = accounts[0];
  const token = account.token;

  if (!account.disney_email || !token || (!token.refresh_token && !token.access_token)) {
    return otpResult('setup_required');
  }

  const lockId = randomUUID();
  const lease = await repo.claim(account.id, lockId);

  if (!lease.acquired) {
    return otpResult('cooldown', { retry_after: Math.max(1, lease.retry_after || 5) });
  }

  let outcome = { status: 'fetch_error' };

  try {
    outcome = await readGmail({
      token,
      recipient: account.disney_email,
      now: clock(),
      onTokenRefresh: (values) =>
        repo.updateToken(account.id, token.connection_version, values),
      onMailboxVerified: (gmail_email) =>
        repo.updateToken(account.id, token.connection_version, { gmail_email }),
    });
  } catch (error) {
    if (['reconnect_required', 'account_mismatch'].includes(error.code)) {
      outcome = { status: error.code };
    }
  }

  if (outcome.status === 'success' && Date.parse(outcome.expires_at) <= clock()) {
    outcome = { status: 'expired' };
  }

  const committed = await repo.finish({
    accountId: account.id,
    lockId,
    connectionVersion: token.connection_version,
    recipient: account.disney_email,
    status: outcome.status,
    messageId: outcome.message_id || null,
    receivedAt: outcome.received_at || null,
  });

  if (!committed) return otpResult('connection_changed');

  const status = outcome.status === 'success' && outcome.message_id === previousMessageId
    ? 'unchanged'
    : outcome.status;

  return otpResult(status, {
    ...outcome,
    account_label: account.label || 'Akun Disney+',
    checked_at: new Date(clock()).toISOString(),
  });
}