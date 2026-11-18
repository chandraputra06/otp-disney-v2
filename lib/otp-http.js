import { phoneVariants } from './phone.js';

export function privateJson(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', ...extraHeaders },
  });
}

export async function handleOtpRequest(request, { authenticate, fetchOtp }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return privateJson({ message: 'Asal permintaan tidak diizinkan.' }, 403);
  try {
    if (!await authenticate()) return privateJson({ message: 'Sesi berakhir. Silakan masuk kembali.' }, 401);
  } catch {
    return privateJson({ message: 'Sesi belum dapat diperiksa. Coba lagi sebentar.' }, 503);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return privateJson({ message: 'Gunakan format JSON.' }, 415);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return privateJson({ message: 'Permintaan terlalu besar.' }, 413);
    body = JSON.parse(raw);
  } catch {
    return privateJson({ message: 'Format permintaan tidak valid.' }, 400);
  }
  if (!body || !phoneVariants(body.phone_number).length) return privateJson({ message: 'Isi nomor yang terdaftar, 10–15 digit.' }, 422);
  if (body.previous_message_id != null && (typeof body.previous_message_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.previous_message_id))) {
    return privateJson({ message: 'Penanda email tidak valid.' }, 422);
  }
  try {
    const result = await fetchOtp(body.phone_number, body.previous_message_id || null);
    return privateJson(result, result.status === 'cooldown' ? 429 : 200,
      result.status === 'cooldown' ? { 'Retry-After': String(result.retry_after) } : {});
  } catch {
    // Never return tokens, database messages, email bodies, or stack traces.
    return privateJson({ status: 'fetch_error', message: 'Server belum siap atau sedang sulit terhubung. Coba lagi sebentar.' }, 503);
  }
}
