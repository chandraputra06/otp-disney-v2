// Helper konversi waktu ke WITA (Asia/Makassar, UTC+8).
// received_at disimpan UTC di database; konversi hanya saat ditampilkan.

export function formatWita(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}.${get('minute')}.${get('second')}`;
}

export function witaTimeShort(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(':', '.');
}
