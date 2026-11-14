
import { createSupabaseAdmin } from './supabase/admin';
import { fetchLatestDisneyMessage } from './gmail';

const COOLDOWN_SECONDS = 5;
const OTP_VALID_MINUTES = 15;
const OTP_MAX_AGE_MS = OTP_VALID_MINUTES * 60 * 1000;

export type OtpStatus =
  | 'success'
  | 'unchanged'
  | 'cooldown'
  | 'not_found'
  | 'parse_failed'
  | 'fetch_error';

export interface OtpResult {
  status: OtpStatus;
  status_label: string;
  phone_number: string;
  message: string;
  otp_code: string | null;
  received_at: string | null;
  last_otp_code: string | null;
  last_received_at: string | null;
}

interface PreviousOtp {
  message_id: string | null;
  received_at: string | null;
}

// Respons gagal tidak pernah mengirim OTP lama.
function makeResult(
  phone: string,
  status: OtpStatus,
  label: string,
  message: string
): OtpResult {
  return {
    status,
    status_label: label,
    phone_number: phone,
    message,
    otp_code: null,
    received_at: null,
    last_otp_code: null,
    last_received_at: null,
  };
}

function successResult(
  phone: string,
  code: string,
  receivedAt: string,
  alreadyFetched: boolean
): OtpResult {
  return {
    status: 'success',
    status_label: 'Berhasil',
    phone_number: phone,
    message: alreadyFetched
      ? 'Kode berasal dari email terbaru yang masih terdeteksi di Gmail. Jika baru meminta kode lain, tunggu email berikutnya masuk.'
      : 'Kode dari email Disney terbaru berhasil ditemukan.',
    otp_code: code,
    received_at: receivedAt,
    last_otp_code: null,
    last_received_at: null,
  };
}

export async function fetchByPhoneNumber(
  phone: string
): Promise<OtpResult> {
  const supabase = createSupabaseAdmin();

  // 1. Cari akun OTP yang aktif.
  const {
    data: account,
    error: accountError,
  } = await supabase
    .from('otp_accounts')
    .select('id')
    .eq('phone_number', phone)
    .eq('is_active', true)
    .maybeSingle();

  if (accountError) {
    throw new Error('Gagal membaca akun OTP.');
  }

  if (!account) {
    return makeResult(
      phone,
      'not_found',
      'Nomor Tidak Ditemukan',
      'Nomor handphone belum terdaftar atau tidak aktif.'
    );
  }

  // 2. Baca riwayat dan token secara paralel.
  // Kode OTP lama tidak perlu dibaca dari database.
  const [previousResponse, tokenResponse] =
    await Promise.all([
      supabase
        .from('otp_messages')
        .select('message_id, received_at')
        .eq('otp_account_id', account.id)
        .eq('fetched_status', 'success')
        .not('otp_code', 'is', null)
        .order('received_at', {
          ascending: false,
        })
        .limit(1)
        .maybeSingle(),

      supabase
        .from('gmail_tokens')
        .select(
          'access_token, refresh_token, expires_at'
        )
        .eq('otp_account_id', account.id)
        .maybeSingle(),
    ]);

  if (previousResponse.error || tokenResponse.error) {
    throw new Error(
      'Gagal membaca token Gmail atau riwayat OTP.'
    );
  }

  const previous = previousResponse.data as
    | PreviousOtp
    | null;

  const token = tokenResponse.data;

  if (!token?.access_token && !token?.refresh_token) {
    return makeResult(
      phone,
      'fetch_error',
      'Gmail Belum Terhubung',
      'Akun Gmail belum dihubungkan untuk nomor ini.'
    );
  }

  // 3. Cooldown database untuk membatasi request.
  const now = new Date();

  const cutoff = new Date(
    now.getTime() - COOLDOWN_SECONDS * 1000
  );

  const {
    data: claimed,
    error: claimError,
  } = await supabase
    .from('otp_accounts')
    .update({
      last_checked_at: now.toISOString(),
    })
    .eq('id', account.id)
    .or(
      `last_checked_at.is.null,last_checked_at.lt.${cutoff.toISOString()}`
    )
    .select('id')
    .maybeSingle();

  if (claimError) {
    throw new Error(
      'Gagal memperbarui waktu pemeriksaan.'
    );
  }

  if (!claimed) {
    return makeResult(
      phone,
      'cooldown',
      'Sedang Menunggu',
      'Pemeriksaan berikutnya belum dapat dilakukan.'
    );
  }

  // 4. Ambil email Disney terbaru langsung dari Gmail.
  try {
    const message = await fetchLatestDisneyMessage(
      {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
      },
      async ({ access_token, expiry_date }) => {
        const values: {
          access_token: string;
          expires_at?: string;
        } = {
          access_token,
        };

        if (expiry_date) {
          values.expires_at =
            new Date(expiry_date).toISOString();
        }

        const { error } = await supabase
          .from('gmail_tokens')
          .update(values)
          .eq('otp_account_id', account.id);

        if (error) {
          throw new Error(
            'Gagal memperbarui access token Gmail.'
          );
        }
      }
    );

    if (!message) {
      return makeResult(
        phone,
        'not_found',
        'Email Belum Ditemukan',
        'Gmail belum menemukan email kode verifikasi Disney yang sesuai.'
      );
    }

    // 5. Wajib memiliki ID email dan waktu penerimaan.
    if (!message.message_id || !message.received_at) {
      return makeResult(
        phone,
        'parse_failed',
        'Data Email Tidak Lengkap',
        'Email ditemukan tetapi identitas atau waktu penerimaannya tidak lengkap.'
      );
    }

    const receivedTime = new Date(
      message.received_at
    ).getTime();

    const ageMs = Date.now() - receivedTime;

    if (
      !Number.isFinite(receivedTime) ||
      ageMs < -60_000
    ) {
      return makeResult(
        phone,
        'parse_failed',
        'Waktu Email Tidak Valid',
        'Waktu penerimaan email tidak dapat diverifikasi.'
      );
    }

    // 6. Jangan menampilkan OTP yang sudah melewati
    // masa berlaku 15 menit sejak email diterima.
    if (ageMs >= OTP_MAX_AGE_MS) {
      return makeResult(
        phone,
        'not_found',
        'Kode Sudah Kedaluwarsa',
        'Email terakhir berusia lebih dari 15 menit. Silakan meminta kode Disney yang baru.'
      );
    }

    // 7. Periksa apakah email lebih lama dari riwayat.
    const previousTime = previous?.received_at
      ? new Date(previous.received_at).getTime()
      : 0;

    const sameMessage =
      message.message_id === previous?.message_id;

    const isOlder =
      previousTime > 0 &&
      receivedTime < previousTime;

    // Log diagnostik tanpa kode OTP maupun token.
    console.info('[OTP CHECK]', {
      sameMessage,
      isOlder,
      emailAgeSeconds: Math.floor(ageMs / 1000),
      hasCode: Boolean(message.otp_code),
    });

    if (isOlder) {
      return makeResult(
        phone,
        'unchanged',
        'Email Baru Belum Terdeteksi',
        'Email yang ditemukan lebih lama daripada riwayat. Kode lama tidak ditampilkan.'
      );
    }

    // 8. Jangan memakai OTP dari database ketika
    // ekstraksi email Gmail gagal.
    if (!message.otp_code) {
      return makeResult(
        phone,
        'parse_failed',
        'Kode Tidak Terbaca',
        'Email Disney terbaru ditemukan, tetapi kode enam digit tidak berhasil dibaca.'
      );
    }

    // 9. Jika Gmail masih menemukan email yang sama,
    // kode boleh digunakan sebagai kode email terbaru
    // yang terdeteksi, selama belum 15 menit.
    // Tidak perlu insert ulang ke database.
    if (sameMessage) {
      return successResult(
        phone,
        message.otp_code,
        message.received_at,
        true
      );
    }

    // 10. Simpan email baru ke riwayat Supabase.
    const { error: insertError } = await supabase
      .from('otp_messages')
      .insert({
        otp_account_id: account.id,
        message_id: message.message_id,
        sender_email: message.sender_email,
        subject: message.subject,
        email_snippet: message.snippet,
        otp_code: message.otp_code,
        fetched_status: 'success',
        received_at: message.received_at,
      });

    if (insertError) {
      console.error(
        '[OTP] Gagal menyimpan riwayat:',
        insertError.message
      );

      // Email sudah berhasil diperiksa secara langsung.
      // Kode masih dapat diberikan kepada pengguna
      // yang sudah diotorisasi oleh endpoint API.
      return {
        ...successResult(
          phone,
          message.otp_code,
          message.received_at,
          false
        ),
        message:
          'Kode terbaru berhasil ditemukan, tetapi riwayat belum berhasil disimpan.',
      };
    }

    return successResult(
      phone,
      message.otp_code,
      message.received_at,
      false
    );
  } catch (error) {
    console.error(
      '[OTP] Gagal mengakses Gmail:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return makeResult(
      phone,
      'fetch_error',
      'Gagal Memeriksa Email',
      'Gmail belum dapat diakses. Silakan coba beberapa saat lagi.'
    );
  }
}
