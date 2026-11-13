
import { createSupabaseAdmin } from './supabase/admin';
import { fetchLatestDisneyMessage } from './gmail';

const COOLDOWN_SECONDS = 5;

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
  otp_code: string | null;
  received_at: string | null;
}

function makeResult(
  phone: string,
  status: OtpStatus,
  label: string,
  message: string,
  previous?: PreviousOtp | null
): OtpResult {
  return {
    status,
    status_label: label,
    phone_number: phone,
    message,
    otp_code: null,
    received_at: null,
    last_otp_code: previous?.otp_code ?? null,
    last_received_at: previous?.received_at ?? null,
  };
}

export async function fetchByPhoneNumber(
  phone: string
): Promise<OtpResult> {
  const supabase = createSupabaseAdmin();

  // 1. Cari akun aktif berdasarkan nomor.
  const { data: account, error: accountError } =
    await supabase
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
      'Tidak Ditemukan',
      'Nomor handphone tidak terdaftar atau tidak aktif.'
    );
  }

  // 2. Baca riwayat OTP sukses paling baru.
  const previousPromise = supabase
    .from('otp_messages')
    .select('message_id, otp_code, received_at')
    .eq('otp_account_id', account.id)
    .eq('fetched_status', 'success')
    .not('otp_code', 'is', null)
    .order('received_at', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  // 3. Ambil token Gmail.
  const tokenPromise = supabase
    .from('gmail_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('otp_account_id', account.id)
    .maybeSingle();

  const [previousResponse, tokenResponse] =
    await Promise.all([
      previousPromise,
      tokenPromise,
    ]);

  if (previousResponse.error || tokenResponse.error) {
    throw new Error('Gagal membaca data OTP.');
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
      'Akun Gmail untuk nomor ini belum terhubung.',
      previous
    );
  }

  // 4. Cooldown atomik berdasarkan timestamp database.
  // Mencegah dua request bersamaan sama-sama
  // mengakses Gmail untuk satu akun.
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - COOLDOWN_SECONDS * 1000
  );

  const { data: claimed, error: claimError } =
    await supabase
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
      'Gagal memperbarui cooldown OTP.'
    );
  }

  if (!claimed) {
    return makeResult(
      phone,
      'cooldown',
      'Tunggu Sebentar',
      'Pemeriksaan Gmail berikutnya belum tersedia.',
      previous
    );
  }

  // 5. Ambil email terbaru dari Gmail.
  try {
    const message = await fetchLatestDisneyMessage(
      {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
      },
      async ({ access_token, expiry_date }) => {
        const updateValues: {
          access_token: string;
          expires_at?: string;
        } = {
          access_token,
        };

        if (expiry_date) {
          updateValues.expires_at =
            new Date(expiry_date).toISOString();
        }

        const { error } = await supabase
          .from('gmail_tokens')
          .update(updateValues)
          .eq('otp_account_id', account.id);

        if (error) {
          throw new Error(
            'Gagal memperbarui token Gmail.'
          );
        }
      }
    );

    if (!message) {
      return makeResult(
        phone,
        'not_found',
        'Email Belum Ditemukan',
        'Belum ditemukan email verifikasi Disney terbaru.',
        previous
      );
    }

    // 6. Jangan anggap email lama sebagai kode baru.
    const sameMessage =
      Boolean(message.message_id) &&
      message.message_id === previous?.message_id;

    const currentTime = message.received_at
      ? new Date(message.received_at).getTime()
      : 0;

    const previousTime = previous?.received_at
      ? new Date(previous.received_at).getTime()
      : 0;

    const isOlder =
      previousTime > 0 &&
      currentTime > 0 &&
      currentTime <= previousTime;

    if (sameMessage || isOlder) {
      return makeResult(
        phone,
        'unchanged',
        'Belum Ada Kode Baru',
        'Email terbaru belum berubah. Kode sebelumnya hanya ditampilkan sebagai riwayat.',
        previous
      );
    }

    // 7. Email baru ada, tetapi kode tidak ditemukan.
    if (!message.otp_code) {
      return makeResult(
        phone,
        'parse_failed',
        'Kode Tidak Terbaca',
        'Email Disney ditemukan tetapi kode verifikasi belum berhasil dibaca.',
        previous
      );
    }

    // 8. Simpan OTP baru.
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
        '[OTP] Gagal menyimpan email baru:',
        insertError.message
      );

      return makeResult(
        phone,
        'fetch_error',
        'Gagal Menyimpan OTP',
        'Kode ditemukan tetapi gagal disimpan ke database.',
        previous
      );
    }

    return {
      status: 'success',
      status_label: 'Berhasil',
      phone_number: phone,
      message: 'Kode OTP terbaru berhasil ditemukan.',
      otp_code: message.otp_code,
      received_at: message.received_at,
      last_otp_code: null,
      last_received_at: null,
    };
  } catch (error) {
    console.error(
      '[OTP] Gagal memeriksa Gmail:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return makeResult(
      phone,
      'fetch_error',
      'Gagal Memeriksa Email',
      'Gmail belum dapat diakses. Silakan coba kembali.',
      previous
    );
  }
}
