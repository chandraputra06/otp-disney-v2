export const NOW = Date.parse('2026-11-17T15:00:00Z');
export const RECIPIENT = 'account.one@example.com';
export const SENDER = 'disneyplus@trx.mail2.disneyplus.com';
const encode = (value) => Buffer.from(value).toString('base64url');

export function email({
  id = 'message-1', code = '703401', recipient = RECIPIENT, sender = SENDER,
  subject = 'Kode OTP Anda untuk Disney+', snippet = '', received = NOW - 60_000,
  text, html, parts = [],
} = {}) {
  const bodies = [];
  if (text !== null) bodies.push({ mimeType: 'text/plain', body: { data: encode(text === undefined ?
    'Berikut kode OTP Anda untuk Disney+\nGunakan kode OTP ini untuk memverifikasi alamat email yang terkait dengan akun MyDisney Anda.\nKode OTP akan kedaluwarsa dalam 15 menit.\n\n' + code + '\n\nJika Anda tidak membuat permintaan ini, silakan kunjungi Pusat Bantuan kami.' : text) } });
  if (html) bodies.push({ mimeType: 'text/html', body: { data: encode(html) } });
  return {
    id, snippet, internalDate: String(received), payload: { mimeType: 'multipart/alternative', headers: [
      { name: 'From', value: 'Disney+ <' + sender + '>' }, { name: 'To', value: recipient }, { name: 'Subject', value: subject },
    ], parts: [...bodies, ...parts] },
  };
}

export function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
