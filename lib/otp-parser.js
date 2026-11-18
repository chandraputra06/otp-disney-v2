import { compile } from 'html-to-text';

export const OTP_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_SENDERS = ['disneyplus@trx.mail2.disneyplus.com'];
export const MAX_INLINE_TEXT_BYTES = 1_125_000;

const htmlBodyText = compile({
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    ...[
      'img', 'head', 'script', 'style', 'blockquote', '.gmail_quote', '[hidden]',
      '[style*="display:none"i]', '[style*="display: none"i]',
    ].map((selector) => ({ selector, format: 'skip' })),
    ...['table', 'tr', 'td', 'th'].map((selector) => ({
      selector,
      format: 'block',
    })),
  ],
});

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function validEmail(value) {
  return typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

export function mailboxIdentity(value) {
  const email = normalizeEmail(value);
  const [local, domain] = email.split('@');

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return local.split('+')[0].replaceAll('.', '') + '@gmail.com';
  }

  return email;
}

export function headerValues(payload, name) {
  return (payload?.headers || [])
    .filter((header) => header.name?.toLowerCase() === name.toLowerCase())
    .map((header) => header.value || '');
}

export function addresses(values) {
  return values.flatMap((value) =>
    value.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []
  );
}

// Untuk menjelaskan perbedaan ejaan. Alamat dengan +tag tetap dibedakan.
function gmailSpelling(address) {
  const [local, domain] = address.split('@');
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return null;

  const [base, ...tags] = local.split('+');
  return [base.replaceAll('.', ''), ...tags].join('+') + '@gmail.com';
}

function subjectText(payload) {
  const subject = headerValues(payload, 'Subject')
    .join(' ')
    .replace(/\r?\n[ \t]+/g, ' ');

  return subject
    .replace(/(\?=)[ \t]+(?==\?)/g, '$1')
    .replace(/=\?([\w.-]+)\?([bq])\?([^?\s]+)\?=/gi, (word, charset, encoding, data) => {
      try {
        const bytes = encoding.toLowerCase() === 'b'
          ? Buffer.from(data, 'base64')
          : Buffer.from(
              data.replaceAll('_', ' ').replace(
                /=([\da-f]{2})/gi,
                (_, hex) => String.fromCharCode(parseInt(hex, 16))
              ),
              'latin1'
            );

        return new TextDecoder(charset, { fatal: true }).decode(bytes);
      } catch {
        return word;
      }
    })
    .replace(/[\u2010\u2011]/g, '-');
}

export function inlineTextParts(payload) {
  const parts = [];

  function visit(part, depth = 0) {
    if (!part || depth > 12 || part.filename) return;

    const mime = (part.mimeType || '').split(';')[0].trim().toLowerCase();
    const isAttachment = headerValues(part, 'Content-Disposition')
      .some((value) => /^\s*attachment/i.test(value));

    if (mime === 'message/rfc822' || isAttachment) return;

    if (mime === 'text/plain' || mime === 'text/html') {
      parts.push({ part, mime });
      return;
    }

    for (const child of part.parts || []) visit(child, depth + 1);
  }

  visit(payload);
  return parts;
}

function emailBodies(payload) {
  const parts = [];
  let incomplete = false;

  for (const { part, mime } of inlineTextParts(payload)) {
    const data = part.body?.data;

    if (!data || data.length > MAX_INLINE_TEXT_BYTES * 4 / 3) {
      if (part.body?.attachmentId || part.body?.size > 0 || data) {
        incomplete = true;
      }
      continue;
    }

    const contentType = headerValues(part, 'Content-Type').join(';') + ';' + part.mimeType;
    const charset = /charset\s*=\s*["']?([\w.-]+)/i.exec(contentType)?.[1] || 'utf-8';

    try {
      const body = new TextDecoder(charset).decode(Buffer.from(data, 'base64url'));
      parts.push(mime === 'text/html' ? htmlBodyText(body) : body);
    } catch {
      incomplete = true;
    }
  }

  return { parts, incomplete };
}

function withoutQuotes(text) {
  return text
    .replace(/[\u00ad\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, ' ')
    .split(/^(?:On .+wrote:|Pada .+menulis:|[- ]{3,}Original Message[- ]*|[- ]{3,}Forwarded message[- ]*)$/im)[0]
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

function readOtp(payload) {
  const { parts, incomplete } = emailBodies(payload);

  if (incomplete || !parts.some((part) => part.trim())) {
    return { detail: 'body_unavailable' };
  }

  const candidates = new Set();

  for (const raw of parts) {
    const body = withoutQuotes(raw);
    const sections = body.split(
      /\b(?:expire(?:s)?\s+in\s+15\s+minutes?|(?:kedaluwarsa|kadaluwarsa)\s+dalam\s+15\s+menit)\b[.!:\s]*/i
    );

    // Di kedua contoh Disney+, kode berada di antara masa berlaku dan teks bantuan.
    if (sections.length === 2) {
      const framed = /^(\d(?:\s*\d){5})\s*(?:If you did not make this request|Jika Anda tidak membuat permintaan ini)\b/i
        .exec(sections[1]);

      if (framed) {
        candidates.add(framed[1].replace(/\D/g, ''));
        continue;
      }
    }

    const standalone = [
      ...body.matchAll(/(?:^|\n)[ \t]*(\d{6}|\d(?:[ \t\r\n]+\d)+)[ \t\r]*(?=\n|$)/g),
    ]
      .map((match) => match[1].replace(/\D/g, ''))
      .filter((value) => value.length === 6);

    const contextual = [
      ...body.matchAll(/(?:kode\s*(?:OTP|verifikasi)|one[ -]time\s*(?:passcode|password)|passcode|verification\s*code|OTP)[^\d\n]{0,80}(\d{6}|\d(?:[ \t]+\d){5})(?!\s*\d)/gi),
    ].map((match) => match[1].replace(/\D/g, ''));

    for (const tail of sections.slice(1)) {
      const match = /^(\d(?:\s*\d){5})(?!\s*\d)(?=\s|$|If\s+you\b|Jika\s+Anda\b)/i.exec(tail);
      if (match) candidates.add(match[1].replace(/\D/g, ''));
    }

    for (const code of [...standalone, ...contextual]) candidates.add(code);
  }

  if (candidates.size === 1) return { code: candidates.values().next().value };
  return { detail: candidates.size ? 'ambiguous' : 'format' };
}

export function extractOtp(payload) {
  return readOtp(payload).code ?? null;
}

function classifyMessage(message, recipient, senders) {
  const payload = message?.payload;
  const from = addresses(headerValues(payload, 'From'));

  if (from.length !== 1 || !senders.includes(from[0])) return 'sender';

  const subject = subjectText(payload);
  if (
    !/disney\s*\+/i.test(subject) ||
    !/one[ -]time\s+(?:passcode|password)|kode\s+(?:OTP|verifikasi)|verification\s+code/i.test(subject)
  ) {
    return 'subject';
  }

  const directRecipients = addresses(
    ['To', 'Cc'].flatMap((name) => headerValues(payload, name))
  );

  const recipients = directRecipients.length
    ? directRecipients
    : addresses(['Delivered-To', 'X-Original-To'].flatMap((name) => headerValues(payload, name)));

  if (recipients.includes(recipient)) return 'exact';

  const spelling = gmailSpelling(recipient);
  if (spelling && recipients.some((address) => gmailSpelling(address) === spelling)) {
    return 'spelling';
  }

  return 'recipient';
}

export function matchesDisneyMessage(message, recipient, senders = DEFAULT_SENDERS) {
  return classifyMessage(message, normalizeEmail(recipient), senders.map(normalizeEmail)) === 'exact';
}

export function selectLatestOtp(messages, { recipient, senders = DEFAULT_SENDERS, now = Date.now() }) {
  const expected = normalizeEmail(recipient);
  const allowed = senders.map(normalizeEmail);
  const matching = [];
  const excluded = new Set();
  let latestSpelling = -Infinity;

  for (const message of messages) {
    const kind = classifyMessage(message, expected, allowed);

    if (kind === 'exact') {
      matching.push(message);
      continue;
    }

    excluded.add(kind);

    if (kind === 'spelling') {
      const received = Number(message.internalDate);

      if (received > now - OTP_TTL_MS && received <= now + 60_000) {
        latestSpelling = Math.max(latestSpelling, received);
      }
    }
  }

  if (!matching.length) {
    if (Number.isFinite(latestSpelling)) return { status: 'recipient_spelling' };

    const detail = ['recipient', 'spelling', 'subject', 'sender']
      .find((kind) => excluded.has(kind)) || 'empty';

    return { status: 'not_found', search_detail: detail === 'spelling' ? 'recipient' : detail };
  }

  if (matching.some((message) =>
    !Number.isFinite(Number(message.internalDate)) || Number(message.internalDate) <= 0
  )) {
    return { status: 'parse_failed', parse_detail: 'timestamp' };
  }

  const sorted = matching.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
  const latest = sorted[0];
  const received = Number(latest.internalDate);

  if (received > now + 60_000) return { status: 'parse_failed', parse_detail: 'timestamp' };
  if (latestSpelling >= received) return { status: 'recipient_spelling' };
  if (now - received >= OTP_TTL_MS) return { status: 'expired' };

  const readings = sorted
    .filter((message) => Number(message.internalDate) === received)
    .map((message) => readOtp(message.payload));

  const code = readings[0].code;

  if (!code || readings.some((reading) => reading.code !== code)) {
    const detail = readings.some((reading) => reading.detail === 'body_unavailable')
      ? 'body_unavailable'
      : readings.length === 1 ? readings[0].detail : 'ambiguous';

    return {
      status: 'parse_failed',
      parse_detail: detail,
      message_id: latest.id,
      received_at: new Date(received).toISOString(),
    };
  }

  return {
    status: 'success',
    otp_code: code,
    message_id: latest.id,
    received_at: new Date(received).toISOString(),
    expires_at: new Date(received + OTP_TTL_MS).toISOString(),
  };
}