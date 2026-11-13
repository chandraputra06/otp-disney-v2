
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const GMAIL_TIMEOUT_MS = 8_000;
const MAX_MESSAGES = 5;

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

function decodeB64Url(data?: string | null): string | null {
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
  text: string | null;
  html: string | null;
} {
  let text: string | null = null;
  let html: string | null = null;

  const walk = (
    part?: gmail_v1.Schema$MessagePart | null
  ) => {
    if (!part) return;

    const data = part.body?.data;

    if (data) {
      if (part.mimeType === 'text/html') {
        html ??= decodeB64Url(data);
      } else {
        text ??= decodeB64Url(data);
      }
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  };

  walk(payload);

  return { text, html };
}

function getHeader(
  payload: gmail_v1.Schema$MessagePart | undefined,
  name: string
): string | null {
  return (
    payload?.headers?.find(
      (item) =>
        item.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

export interface DisneyMessage {
  message_id: string | null;
  snippet: string | null;
  subject: string | null;
  sender_email: string | null;
  otp_code: string | null;
  received_at: string | null;
}

function extractOtpCode(content: string): string | null {
  const normalized = content
    .replace(/\s+/g, ' ')
    .trim();

  // Cari angka yang berada setelah keterangan OTP.
  const patterns = [
    /(?:verification code|security code|one.time code|passcode|kode verifikasi|kode keamanan|kode otp|otp code|otp|your code|kode anda|kode kamu)[^\d]{0,100}(\d{4,6})\b/i,
    /\b(\d{4,6})\b[^\w]{0,20}(?:is your|adalah kode|verification code)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }

  // Fallback seperti parser project sebelumnya.
  const fallback = normalized.match(/\b\d{6}\b/);

  return fallback?.[0] ?? null;
}

function parseMessage(
  full: gmail_v1.Schema$Message
): DisneyMessage {
  const payload = full.payload ?? undefined;
  const bodies = extractBodies(payload);

  const subject = getHeader(payload, 'Subject');
  const sender = getHeader(payload, 'From');

  const plainContent = [
    subject,
    full.snippet,
    bodies.text,
    bodies.html?.replace(/<[^>]*>/g, ' '),
  ]
    .filter(Boolean)
    .join('\n');

  const receivedAt = Number(full.internalDate);

  return {
    message_id: full.id ?? null,
    snippet: full.snippet ?? null,
    subject,
    sender_email: sender,
    otp_code: extractOtpCode(plainContent),
    received_at:
      Number.isFinite(receivedAt) && receivedAt > 0
        ? new Date(receivedAt).toISOString()
        : null,
  };
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

  const pendingTokenWrites: Promise<void>[] = [];

  if (onTokenRefresh) {
    auth.on('tokens', (newTokens) => {
      if (!newTokens.access_token) return;

      const write = onTokenRefresh({
        access_token: newTokens.access_token,
        expiry_date: newTokens.expiry_date ?? null,
      }).catch((error) => {
        console.error(
          '[GMAIL] Gagal menyimpan token baru:',
          error
        );
      });

      pendingTokenWrites.push(write);
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
    'newer_than:2d (Disney OR "Disney+")';

  try {
    const response = await gmail.users.messages.list(
      {
        userId: 'me',
        q: query,
        maxResults: MAX_MESSAGES,
      },
      requestOptions
    );

    const messages = (response.data.messages ?? [])
      .filter((item) => Boolean(item.id));

    if (messages.length === 0) {
      return null;
    }

    // Ambil detail beberapa email secara paralel.
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

    const parsed: DisneyMessage[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        parsed.push(
          parseMessage(result.value.data)
        );
      } else {
        console.warn(
          '[GMAIL] Salah satu email gagal dibaca.'
        );
      }
    }

    if (parsed.length === 0) {
      throw new Error(
        'Gagal mengambil detail email dari Gmail.'
      );
    }

    // Urutkan berdasarkan waktu penerimaan.
    parsed.sort(
      (a, b) =>
        new Date(b.received_at ?? 0).getTime() -
        new Date(a.received_at ?? 0).getTime()
    );

    // Hindari mengambil kode dari email tidak terkait.
    const disneyMessages = parsed.filter((message) =>
      /disney/i.test(
        `${message.sender_email ?? ''} ${message.subject ?? ''}`
      )
    );

    const latestWithCode = disneyMessages.find(
      (message) => Boolean(message.otp_code)
    );

    return (
      latestWithCode ??
      disneyMessages[0] ??
      null
    );
  } finally {
    await Promise.all(pendingTokenWrites);
  }
}
