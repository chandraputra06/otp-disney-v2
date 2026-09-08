// Logika inti: ambil OTP berdasarkan nomor HP.
// Termasuk COOLDOWN (anti-spam) + CACHE (hemat panggilan Gmail saat auto-refresh).
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from './supabase/admin';
import { fetchLatestDisneyMessage } from './gmail';

const COOLDOWN_SECONDS = 5;  // jarak minimal antar-pemanggilan Gmail per nomor
const CACHE_SECONDS = 12;    // sajikan OTP sukses terbaru tanpa panggil Gmail lagi

export type OtpStatus = 'success' | 'cooldown' | 'not_found' | 'parse_failed' | 'fetch_error';

export interface OtpResult {
  status: OtpStatus;
  status_label: string;
  phone_number: string;
  message: string;
  otp_code: string | null;
  received_at: string | null;      // ISO UTC; frontend format ke WITA
  last_otp_code: string | null;
  last_received_at: string | null;
}

async function lastSuccess(supabase: SupabaseClient, accountId: string) {
  const { data } = await supabase
    .from('otp_messages')
    .select('otp_code, received_at')
    .eq('otp_account_id', accountId)
    .eq('fetched_status', 'success')
    .not('otp_code', 'is', null)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    last_otp_code: data?.otp_code ?? null,
    last_received_at: data?.received_at ?? null,
  };
}

export async function fetchByPhoneNumber(phone: string): Promise<OtpResult> {
  const supabase = createSupabaseAdmin();

  const { data: account } = await supabase
    .from('otp_accounts')
    .select('*')
    .eq('phone_number', phone)
    .eq('is_active', true)
    .maybeSingle();

  if (!account) {
    return {
      status: 'not_found', status_label: 'Tidak Ditemukan', phone_number: phone,
      message: 'Nomor handphone tidak terdaftar atau tidak aktif.',
      otp_code: null, received_at: null, last_otp_code: null, last_received_at: null,
    };
  }

  // 1) CACHE: kalau baru saja ada OTP sukses, sajikan tanpa memanggil Gmail
  const { data: recent } = await supabase
    .from('otp_messages')
    .select('otp_code, received_at, created_at')
    .eq('otp_account_id', account.id)
    .eq('fetched_status', 'success')
    .not('otp_code', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.created_at) {
    const ageSec = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (ageSec < CACHE_SECONDS) {
      return {
        status: 'success', status_label: 'Berhasil', phone_number: phone,
        message: 'OTP terbaru.', otp_code: recent.otp_code, received_at: recent.received_at,
        last_otp_code: null, last_received_at: null,
      };
    }
  }

  // 2) COOLDOWN: cegah pemanggilan beruntun
  if (account.last_checked_at) {
    const ageSec = (Date.now() - new Date(account.last_checked_at).getTime()) / 1000;
    if (ageSec < COOLDOWN_SECONDS) {
      const fb = await lastSuccess(supabase, account.id);
      return {
        status: 'cooldown', status_label: 'Tunggu Sebentar', phone_number: phone,
        message: `Silakan tunggu ${Math.ceil(COOLDOWN_SECONDS - ageSec)} detik sebelum refresh lagi.`,
        otp_code: null, received_at: null, ...fb,
      };
    }
  }

  await supabase
    .from('otp_accounts')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('id', account.id);

  // 3) Ambil token Gmail
  const { data: token } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('otp_account_id', account.id)
    .maybeSingle();

  if (!token) {
    const fb = await lastSuccess(supabase, account.id);
    return {
      status: 'fetch_error', status_label: 'Belum Terhubung', phone_number: phone,
      message: 'Akun Gmail belum terhubung untuk nomor ini.',
      otp_code: null, received_at: null, ...fb,
    };
  }

  // 4) Panggil Gmail (dengan timeout di lib/gmail.ts)
  try {
    const msg = await fetchLatestDisneyMessage(
      { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: token.expires_at },
      async ({ access_token, expiry_date }) => {
        await supabase
          .from('gmail_tokens')
          .update({
            access_token,
            expires_at: expiry_date ? new Date(expiry_date).toISOString() : null,
          })
          .eq('otp_account_id', account.id);
      }
    );

    if (!msg) {
      await supabase.from('otp_messages').insert({ otp_account_id: account.id, fetched_status: 'not_found' });
      const fb = await lastSuccess(supabase, account.id);
      return {
        status: 'not_found', status_label: 'Email Tidak Ditemukan', phone_number: phone,
        message: 'Email Disney terbaru belum ditemukan.',
        otp_code: null, received_at: null, ...fb,
      };
    }

    await supabase.from('otp_messages').insert({
      otp_account_id: account.id,
      message_id: msg.message_id,
      sender_email: msg.sender_email,
      subject: msg.subject,
      email_snippet: msg.snippet,
      otp_code: msg.otp_code,
      fetched_status: msg.otp_code ? 'success' : 'parse_failed',
      received_at: msg.received_at,
    });

    if (!msg.otp_code) {
      const fb = await lastSuccess(supabase, account.id);
      return {
        status: 'parse_failed', status_label: 'OTP Tidak Terbaca', phone_number: phone,
        message: 'Email ditemukan, tetapi kode OTP belum berhasil diekstrak.',
        otp_code: null, received_at: msg.received_at, ...fb,
      };
    }

    return {
      status: 'success', status_label: 'Berhasil', phone_number: phone,
      message: 'OTP berhasil ditemukan.',
      otp_code: msg.otp_code, received_at: msg.received_at,
      last_otp_code: null, last_received_at: null,
    };
  } catch {
    await supabase.from('otp_messages').insert({ otp_account_id: account.id, fetched_status: 'fetch_error' });
    const fb = await lastSuccess(supabase, account.id);
    return {
      status: 'fetch_error', status_label: 'Terjadi Kesalahan', phone_number: phone,
      message: 'Gagal mengambil email OTP.',
      otp_code: null, received_at: null, ...fb,
    };
  }
}
