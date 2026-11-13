
import {
  NextRequest,
  NextResponse,
} from 'next/server';

import { fetchByPhoneNumber } from '@/lib/otp';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 25;

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
};

export async function POST(req: NextRequest) {
  try {
    // 1. Periksa autentikasi terlebih dahulu.
    const supabase =
      await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          message:
            'Silakan login terlebih dahulu untuk mengakses OTP.',
        },
        {
          status: 401,
          headers: responseHeaders,
        }
      );
    }

    // 2. Baca data permintaan.
    let body: { phone_number?: string };

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          message: 'Format permintaan tidak valid.',
        },
        {
          status: 400,
          headers: responseHeaders,
        }
      );
    }

    // 3. Validasi nomor handphone.
    const phone = String(
      body?.phone_number ?? ''
    ).replace(/\D+/g, '');

    if (!/^[0-9]{10,15}$/.test(phone)) {
      return NextResponse.json(
        {
          message:
            'Nomor handphone harus berisi 10 sampai 15 digit.',
        },
        {
          status: 422,
          headers: responseHeaders,
        }
      );
    }

    // 4. Ambil OTP terbaru.
    const result = await fetchByPhoneNumber(phone);

    return NextResponse.json(result, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(
      '[API OTP]',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return NextResponse.json(
      {
        message:
          'Terjadi kesalahan pada server. Silakan coba kembali.',
      },
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
}
