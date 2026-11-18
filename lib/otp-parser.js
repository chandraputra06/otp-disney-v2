import { convert } from 'html-to-text';

export const OTP_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_SENDERS = ['disneyplus@trx.mail2.disneyplus.com'];

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

// Gmail aliases can identify one mailbox, but recipients stay exact to avoid
// mixing two Disney accounts using different +aliases in that same mailbox.
export function mailboxIdentity(value) {
  const email = normalizeEmail(value);
  const [local, domain] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return local.split('+')[0].replaceAll('.', '') + '@gmail.com';
  }
  return email;
}

export function headerValues(payload, name) {
  return (payload?.headers || []).filter((h) => h.name?.toLowerCase() === name.toLowerCase()).map((h) => h.value || '');
}

export function addresses(values) {
  return values.flatMap((value) => value.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
}

function emailBodies(payload) {
  const parts = [];
  function visit(part, depth = 0) {
    if (!part || depth > 12 || part.filename || part.mimeType === 'message/rfc822') return;
    if (headerValues(part, 'Content-Disposition').some((v) => /^attachment/i.test(v))) return;
    if (['text/plain', 'text/html'].includes(part.mimeType) && part.body?.data) {
      if (part.body.data.length > 1_500_000) return;
      const body = Buffer.from(part.body.data, 'base64url').toString('utf8');
      parts.push(part.mimeType === 'text/html' ? convert(body, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'head', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'blockquote', format: 'skip' },
          { selector: '.gmail_quote', format: 'skip' },
        ],
      }) : body);
    }
    for (const child of part.parts || []) visit(child, depth + 1);
  }
  visit(payload);
  return parts;
}

function withoutQuotes(text) {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').split(/^(?:On .+wrote:|Pada .+menulis:|[- ]{3,}Original Message[- ]*|[- ]{3,}Forwarded message[- ]*)$/im)[0]
    .split('\n').filter((line) => !/^\s*>/.test(line)).join('\n');
}

export function extractOtp(payload) {
  const candidates = new Set();
  for (const raw of emailBodies(payload)) {
    const body = withoutQuotes(raw);
    // Exactly six digits, including a leading zero and split HTML digit cells.
    const standalone = [...body.matchAll(/(?:^|\n)[ \t]*(\d{6}|\d(?:[ \t\u00a0\r\n]+\d){5})[ \t\r]*(?=\n|$)/g)]
      .map((m) => m[1].replace(/\D/g, ''));
    const contextual = [...body.matchAll(/(?:kode\s*(?:OTP|verifikasi)|one[ -]time\s*(?:passcode|password)|passcode|verification\s*code|OTP)[^\d\n]{0,80}(\d{6}|\d(?:[ \t\u00a0]+\d){5})(?![\d \t\u00a0]*\d)/gi)]
      .map((m) => m[1].replace(/\D/g, ''));
    for (const code of [...standalone, ...contextual]) if (/^\d{6}$/.test(code)) candidates.add(code);
  }
  // Conflicting MIME parts/codes are ambiguous. Never pick the first number.
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function matchesDisneyMessage(message, recipient, senders = DEFAULT_SENDERS) {
  const payload = message?.payload;
  const from = addresses(headerValues(payload, 'From'));
  const subject = headerValues(payload, 'Subject').join(' ');
  const directRecipients = addresses(['To', 'Cc'].flatMap((h) => headerValues(payload, h)));
  // Delivered-To is the mailbox, and may differ from an intentional +alias.
  // It must not override an explicit To/Cc for another Disney account.
  const recipients = directRecipients.length ? directRecipients :
    addresses(['Delivered-To', 'X-Original-To'].flatMap((h) => headerValues(payload, h)));
  return from.length === 1 && senders.map(normalizeEmail).includes(from[0]) &&
    recipients.includes(normalizeEmail(recipient)) && /disney\s*\+/i.test(subject) &&
    /one[ -]time\s+(?:passcode|password)|kode\s+(?:OTP|verifikasi)|verification\s+code/i.test(subject);
}

export function selectLatestOtp(messages, { recipient, senders = DEFAULT_SENDERS, now = Date.now() }) {
  const matching = messages.filter((message) => matchesDisneyMessage(message, recipient, senders));
  if (!matching.length) return { status: 'not_found' };
  if (matching.some((m) => !Number.isFinite(Number(m.internalDate)) || Number(m.internalDate) <= 0)) return { status: 'parse_failed' };
  const sorted = matching.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
  const latest = sorted[0];
  const received = Number(latest.internalDate);
  if (received > now + 60_000) return { status: 'parse_failed' };
  if (now - received >= OTP_TTL_MS) return { status: 'expired' };
  const code = extractOtp(latest.payload);
  if (!code || sorted.some((m) => m.id !== latest.id && Number(m.internalDate) === received && extractOtp(m.payload) !== code)) {
    return { status: 'parse_failed', message_id: latest.id, received_at: new Date(received).toISOString() };
  }
  return {
    status: 'success', otp_code: code, message_id: latest.id,
    received_at: new Date(received).toISOString(), expires_at: new Date(received + OTP_TTL_MS).toISOString(),
  };
}
