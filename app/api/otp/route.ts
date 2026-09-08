import { NextRequest, NextResponse } from 'next/server';
import { fetchByPhoneNumber } from '@/lib/otp';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  let body: { phone_number?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Format permintaan tidak valid.' }, { status: 400 });
  }

  const raw = String(body?.phone_number ?? '').replace(/\D+/g, '');
  if (!/^[0-9]{10,15}$/.test(raw)) {
    return NextResponse.json(
      { message: 'Nomor handphone harus berupa angka 10 sampai 15 digit.' },
      { status: 422 }
    );
  }

  const result = await fetchByPhoneNumber(raw);
  return NextResponse.json(result);
}