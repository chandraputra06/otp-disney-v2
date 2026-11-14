
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const GMAIL_TIMEOUT_MS = 10_000;
const MAX_MESSAGES = 15;

function envValue(value?: string): string {
  return (value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

const DISNEY_SENDER = (
  envValue(process.env.OTP_GMAIL_SENDER) ||
  'disneyplus@trx.mail2.disneyplus.com'
).toLowerCase();

const DEBUG_GMAIL =
  process.env.OTP_GMAIL_DEBUG === 'true';

const EXPECTED_GMAIL = envValue(
  process.env.OTP_EXPECTED_GMAIL
).toLowerCase();

// ========================================
// GOOGLE OAUTH
// ========================================

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

export async function exchangeCodeForTokens(
  code: string
) {
  const { tokens } =
    await makeOAuthClient().getToken(code);

  return tokens;
}

// ========================================
// TYPES
// ========================================

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

// ========================================
// HELPERS
// ========================================

function debugLog(
  label: string,
  data: Record<string, unknown>
) {
  if (!DEBUG_GMAIL) return;

  console.info(`[GMAIL DEBUG] ${label}`, data);
}

function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');

  return (
    `${name.slice(0, 2)}***@${domain || 'unknown'}`
  );
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

function getHeader(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
  name: string
): string | null {
  return (
    payload?.headers?.find(
      (header) =>
        header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function normalizeEmailAddress(
  from: string | null
): string | null {
  if (!from) return null;

  const match = from.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  return match?.[0]?.toLowerCase() ?? null;
}

// ========================================
// EMAIL BODY EXTRACTION
// ========================================

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

    const mime = part.mimeType?.toLowerCase();
    const decoded = decodeB64Url(part.body?.data);

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

function htmlToText(html: string): string {
  return html
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      ' '
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      ' '
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(?:p|div|tr|table|h[1-6])>/gi,
      '\n'
    )
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, num: string) =>
      String.fromCodePoint(Number(num))
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ========================================
// OTP EXTRACTION
// ========================================

function findSixDigitCodes(
  text: string
): string[] {
  const codes: string[] = [];

  // Mendukung 123456 dan 1 2 3 4 5 6.
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

function extractOtpCode(
  content: string
): string | null {
  const text = content
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .trim();

  const keywords =
    /(?:one[\s-]?time passcode|verification code|security code|passcode|otp|kode verifikasi|kode keamanan|kode otp)/gi;

  // Cari kode di sekitar keterangan verifikasi.
  for (const keyword of text.matchAll(keywords)) {
    const start =
      (keyword.index ?? 0) + keyword[0].length;

    const nearby = text.slice(start, start + 350);

    const codes = findSixDigitCodes(nearby);

    if (codes.length === 1) {
      return codes[0];
    }
  }

  // Jika hanya ada satu kandidat unik di seluruh
  // teks, gunakan kandidat tersebut.
  // Jangan menebak jika ada beberapa kode berbeda.
  const allCodes = findSixDigitCodes(text);

  return allCodes.length === 1
    ? allCodes[0]
    : null;
}

// ========================================
// PARSE GMAIL MESSAGE
// ========================================

function parseMessage(
  full: gmail_v1.Schema$Message
): DisneyMessage {
  const payload = full.payload;

  const bodies = extractBodies(payload);

  const subject = getHeader(payload, 'Subject');
  const sender = getHeader(payload, 'From');

  // Prioritaskan text/plain yang berasal langsung
  // dari email, kemudian HTML, lalu snippet.
  const sources = [
    bodies.text,
    htmlToText(bodies.html),
    full.snippet ?? '',
  ];

  let otpCode: string | null = null;

  for (const source of sources) {
    if (!source.trim()) continue;

    otpCode = extractOtpCode(source);

    if (otpCode) break;
  }

  const internalDate = Number(full.internalDate);

  const receivedAt =
    Number.isFinite(internalDate) &&
    internalDate > 0
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

// ========================================
// VALIDATE DISNEY EMAIL
// ========================================

function isRelevantDisneyEmail(
  message: DisneyMessage
): boolean {
  const sender = normalizeEmailAddress(
    message.sender_email
  );

  if (sender !== DISNEY_SENDER) {
    return false;
  }

  // Tetap pastikan subjek terkait verifikasi.
  return /(?:passcode|verification|security code|one[\s-]?time|otp|kode verifikasi)/i.test(
    message.subject ?? ''
  );
}

// ========================================
// FETCH LATEST DISNEY MESSAGE
// ========================================

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

      tokenWrites.push(
        onTokenRefresh({
          access_token: newTokens.access_token,
          expiry_date:
            newTokens.expiry_date ?? null,
        }).catch((error) => {
          console.error(
            '[GMAIL] Token update failed:',
            error instanceof Error
              ? error.message
              : 'Unknown error'
          );
        })
      );
    });
  }

  const gmail = google.gmail({
    version: 'v1',
    auth,
  });

  const options = {
    timeout: GMAIL_TIMEOUT_MS,
  };

  try {
    // ------------------------------------
    // 1. PERIKSA AKUN GMAIL TERHUBUNG
    // ------------------------------------

    if (DEBUG_GMAIL || EXPECTED_GMAIL) {
      const profile = await gmail.users.getProfile(
        { userId: 'me' },
        options
      );

      const linkedEmail = (
        profile.data.emailAddress ?? ''
      ).trim().toLowerCase();

      debugLog('Connected account', {
        account: maskEmail(linkedEmail),
      });

      if (
        EXPECTED_GMAIL &&
        linkedEmail !== EXPECTED_GMAIL
      ) {
        console.error(
          '[GMAIL] Akun OAuth tidak sesuai dengan inbox yang diharapkan.'
        );

        throw new Error(
          'Akun Gmail yang terhubung tidak sesuai.'
        );
      }
    }

    // ------------------------------------
    // 2. SIAPKAN QUERY PENCARIAN
    // ------------------------------------

    const senderQuery =
      `from:${DISNEY_SENDER} newer_than:3d`;

    const customQuery = envValue(
      process.env.OTP_GMAIL_QUERY
    );

    // Pencarian berdasarkan pengirim selalu
    // disertakan agar query custom tidak
    // menyembunyikan email yang lebih baru.
    const queries = [
      senderQuery,
      ...(customQuery &&
      customQuery !== senderQuery
        ? [customQuery]
        : []),
    ];

    const candidateIds = new Set<string>();

    for (const query of queries) {
      const response =
        await gmail.users.messages.list(
          {
            userId: 'me',
            q: query,
            maxResults: MAX_MESSAGES,
          },
          options
        );

      const found = response.data.messages ?? [];

      for (const message of found) {
        if (message.id) {
          candidateIds.add(message.id);
        }
      }

      debugLog('Search', {
        type:
          query === senderQuery
            ? 'sender'
            : 'custom',
        results: found.length,
      });
    }

    // ------------------------------------
    // 3. PENCARIAN CADANGAN
    // ------------------------------------

    // Jika query pengirim tidak menemukan pesan,
    // cari berdasarkan subjek untuk diagnosis.
    // Hasilnya tetap wajib lulus pemeriksaan
    // alamat pengirim di bawah.
    if (candidateIds.size === 0) {
      const fallback =
        await gmail.users.messages.list(
          {
            userId: 'me',
            q:
              'subject:"Your one-time passcode for Disney+" newer_than:3d',
            maxResults: MAX_MESSAGES,
          },
          options
        );

      for (const message of (
        fallback.data.messages ?? []
      )) {
        if (message.id) {
          candidateIds.add(message.id);
        }
      }

      debugLog('Fallback search', {
        results:
          fallback.data.messages?.length ?? 0,
      });
    }

    if (candidateIds.size === 0) {
      console.warn(
        '[GMAIL] Tidak ada kandidat email Disney ditemukan.'
      );

      return null;
    }

    // ------------------------------------
    // 4. AMBIL DETAIL EMAIL
    // ------------------------------------

    const ids = [...candidateIds];

    const results = await Promise.allSettled(
      ids.map((id) =>
        gmail.users.messages.get(
          {
            userId: 'me',
            id,
            format: 'full',
          },
          options
        )
      )
    );

    const rejectedCount = results.filter(
      (result) => result.status === 'rejected'
    ).length;

    // Jika detail email ada yang gagal diambil,
    // kita tidak bisa memastikan email terbaru.
    if (rejectedCount > 0) {
      throw new Error(
        `Gagal membaca ${rejectedCount} kandidat email Gmail.`
      );
    }

    const parsed: DisneyMessage[] = [];

    let rejectedSender = 0;
    let rejectedSubject = 0;

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      const message = parseMessage(
        result.value.data
      );

      const sender = normalizeEmailAddress(
        message.sender_email
      );

      const senderMatches =
        sender === DISNEY_SENDER;

      const subjectMatches =
        /(?:passcode|verification|security code|one[\s-]?time|otp|kode verifikasi)/i.test(
          message.subject ?? ''
        );

      if (!senderMatches) {
        rejectedSender += 1;
      } else if (!subjectMatches) {
        rejectedSubject += 1;
      }

      debugLog('Candidate', {
        senderMatches,
        subjectMatches,
        receivedAt: message.received_at,
        hasCode: Boolean(message.otp_code),
      });

      if (isRelevantDisneyEmail(message)) {
        parsed.push(message);
      }
    }

    debugLog('Validation', {
      candidates: ids.length,
      accepted: parsed.length,
      rejectedSender,
      rejectedSubject,
    });

    // ------------------------------------
    // 5. PILIH EMAIL TERBARU
    // ------------------------------------

    if (parsed.length === 0) {
      console.warn(
        '[GMAIL] Tidak ada email yang lolos validasi pengirim dan subjek.'
      );

      return null;
    }

    parsed.sort((a, b) => {
      const timeA = a.received_at
        ? Date.parse(a.received_at)
        : 0;

      const timeB = b.received_at
        ? Date.parse(b.received_at)
        : 0;

      return timeB - timeA;
    });

    const latest = parsed[0];

    // Tidak memakai kode dari email lebih lama
    // apabila email terbaru tidak terbaca.
    debugLog('Latest email', {
      receivedAt: latest.received_at,
      hasCode: Boolean(latest.otp_code),
      candidateCount: parsed.length,
    });

    return latest;
  } catch (error) {
    console.error(
      '[GMAIL] Fetch failed:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    throw error;
  } finally {
    await Promise.all(tokenWrites);
  }
}
