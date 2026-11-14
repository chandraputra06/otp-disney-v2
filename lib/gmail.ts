
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const GMAIL_TIMEOUT_MS = 8_000;
const MAX_MESSAGES = 10;

// Sesuai alamat pengirim pada screenshot Gmail.
// Bisa diubah melalui environment variable.
const DISNEY_SENDER =
  process.env.OTP_GMAIL_SENDER?.trim().toLowerCase() ||
  'disneyplus@trx.mail2.disneyplus.com';

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state: string): string {
  return makeOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const { tokens } = await makeOAuthClient().getToken(code);
  return tokens;
}

export interface DisneyMessage {
  message_id: string | null;
  snippet: string | null;
  subject: string | null;
  sender_email: string | null;
  otp_code: string | null;
  received_at: string | null;
}

interface GmailTokens {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

interface RefreshedToken {
  access_token: string;
  expiry_date: number | null;
}

function decodeB64Url(
  data?: string | null
): string | null {
  if (!data) return null;

  try {
    return Buffer.from(
      data.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
  } catch {
    return null;
  }
}

function extractBodies(
  payload?: gmail_v1.Schema$MessagePart | null
): {
  text: string;
  html: string;
} {
  const texts: string[] = [];
  const htmls: string[] = [];

  const walk = (
    part?: gmail_v1.Schema$MessagePart | null
  ) => {
    if (!part) return;

    const decoded = decodeB64Url(part.body?.data);
    const mime = part.mimeType?.toLowerCase();

    if (decoded) {
      if (mime === 'text/html') {
        htmls.push(decoded);
      } else if (
        mime === 'text/plain' ||
        (!mime && !part.parts?.length)
      ) {
        texts.push(decoded);
      }
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  };

  walk(payload);

  return {
    text: texts.join('\n'),
    html: htmls.join('\n'),
  };
}

function getHeader(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
  name: string
): string | null {
  return (
    payload?.headers?.find(
      (item) =>
        item.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function normalizeEmailAddress(
  from: string | null
): string | null {
  if (!from) return null;

  const angle = from.match(/<([^>]+)>/);
  return (angle?.[1] ?? from).trim().toLowerCase();
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|table|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, num: string) =>
      String.fromCodePoint(Number(num))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
}

// Mengambil kandidat enam digit, termasuk jika
// angka dipisahkan spasi oleh template email.
function findSixDigitCodes(text: string): string[] {
  const codes: string[] = [];
  const pattern =
    /(?<!\d)(?:\d[ \t]{0,2}){5}\d(?!\d)/g;

  for (const match of text.matchAll(pattern)) {
    const code = match[0].replace(/\D/g, '');

    if (code.length === 6) {
      codes.push(code);
    }
  }

  return [...new Set(codes)];
}

function extractOtpCode(content: string): string | null {
  const text = content
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .trim();

  // Prioritaskan angka di sekitar kata kunci.
  const keywords =
    /(?:one[\s-]?time passcode|verification code|security code|passcode|otp|kode verifikasi|kode keamanan|kode otp)/gi;

  for (const keyword of text.matchAll(keywords)) {
    const start = keyword.index ?? 0;
    const nearby = text.slice(start, start + 350);
    const codes = findSixDigitCodes(nearby);

    if (codes.length === 1) {
      return codes[0];
    }
  }

  // Fallback hanya bila ada tepat satu kandidat unik.
  // Jika ada beberapa kode berbeda, jangan menebak.
  const codes = findSixDigitCodes(text);

  return codes.length === 1 ? codes[0] : null;
}

function parseMessage(
  full: gmail_v1.Schema$Message
): DisneyMessage {
  const payload = full.payload;
  const bodies = extractBodies(payload);

  const subject = getHeader(payload, 'Subject');
  const sender = getHeader(payload, 'From');

  const sources = [
    `${subject ?? ''}\n${bodies.text}`,
    `${subject ?? ''}\n${htmlToText(bodies.html)}`,
    `${subject ?? ''}\n${full.snippet ?? ''}`,
  ];

  let otpCode: string | null = null;

  for (const source of sources) {
    if (!source.trim()) continue;

    otpCode = extractOtpCode(source);

    if (otpCode) break;
  }

  const internalDate = Number(full.internalDate);
  const receivedAt =
    Number.isFinite(internalDate) && internalDate > 0
      ? new Date(internalDate).toISOString()
      : null;

  return {
    message_id: full.id ?? null,
    snippet: full.snippet ?? null,
    subject,
    sender_email: sender,
    otp_code: otpCode,
    received_at: receivedAt,
  };
}

function isRelevantDisneyEmail(
  message: DisneyMessage
): boolean {
  const sender = normalizeEmailAddress(
    message.sender_email
  );

  if (sender !== DISNEY_SENDER) {
    return false;
  }

  // Hanya email terkait kode verifikasi.
  return /(?:passcode|verification|security code|one.time code|otp|kode verifikasi)/i.test(
    message.subject ?? ''
  );
}

export async function fetchLatestDisneyMessage(
  tokens: GmailTokens,
  onTokenRefresh?: (
    token: RefreshedToken
  ) => Promise<void>
): Promise<DisneyMessage | null> {
  const auth = makeOAuthClient();

  auth.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expires_at
      ? new Date(tokens.expires_at).getTime()
      : undefined,
  });

  const tokenWrites: Promise<void>[] = [];

  if (onTokenRefresh) {
    auth.on('tokens', (newTokens) => {
      if (!newTokens.access_token) return;

      const write = onTokenRefresh({
        access_token: newTokens.access_token,
        expiry_date: newTokens.expiry_date ?? null,
      }).catch((error) => {
        console.error(
          '[GMAIL] Gagal menyimpan token:',
          error instanceof Error
            ? error.message
            : 'Unknown error'
        );
      });

      tokenWrites.push(write);
    });
  }

  const gmail = google.gmail({
    version: 'v1',
    auth,
  });

  const requestOptions = {
    timeout: GMAIL_TIMEOUT_MS,
  };

  const query =
    process.env.OTP_GMAIL_QUERY?.trim() ||
    `from:${DISNEY_SENDER} newer_than:2d`;

  try {
    const response = await gmail.users.messages.list(
      {
        userId: 'me',
        q: query,
        maxResults: MAX_MESSAGES,
      },
      requestOptions
    );

    const messages = (
      response.data.messages ?? []
    ).filter((item) => Boolean(item.id));

    if (messages.length === 0) {
      return null;
    }

    // Ambil detail email secara paralel.
    const results = await Promise.allSettled(
      messages.map((item) =>
        gmail.users.messages.get(
          {
            userId: 'me',
            id: item.id!,
            format: 'full',
          },
          requestOptions
        )
      )
    );

    // Hindari memakai email lama jika detail
    // kandidat pertama gagal diambil.
    if (results[0]?.status === 'rejected') {
      throw new Error(
        'Gagal memeriksa email kandidat terbaru.'
      );
    }

    const parsed: DisneyMessage[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const message = parseMessage(
          result.value.data
        );

        if (isRelevantDisneyEmail(message)) {
          parsed.push(message);
        }
      }
    }

    if (parsed.length === 0) {
      return null;
    }

    // Urutkan berdasarkan waktu Gmail, terbaru dahulu.
    parsed.sort(
      (a, b) =>
        new Date(b.received_at ?? 0).getTime() -
        new Date(a.received_at ?? 0).getTime()
    );

    // PENTING:
    // Jangan mengambil email lama hanya karena
    // email terbaru tidak berhasil diekstrak.
    return parsed[0];
  } finally {
    await Promise.all(tokenWrites);
  }
}
