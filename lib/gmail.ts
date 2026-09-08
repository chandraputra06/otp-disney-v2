// Layanan Gmail: bikin OAuth client, ambil email Disney terbaru, ekstrak OTP.
// PENTING: setiap panggilan Gmail diberi TIMEOUT supaya tidak menggantung.
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const GMAIL_TIMEOUT_MS = 10_000; // maks 10 detik per panggilan Gmail

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
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const { tokens } = await makeOAuthClient().getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, ... }
}

function decodeB64Url(data?: string | null): string | null {
  if (!data) return null;
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBodies(payload: any): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (part: any) => {
    if (!part) return;
    const data = part.body?.data;
    if (part.mimeType === 'text/plain' && data && !text) text = decodeB64Url(data);
    if (part.mimeType === 'text/html' && data && !html) html = decodeB64Url(data);
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return { text, html };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function header(payload: any, name: string): string | null {
  const h = (payload?.headers || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (x: any) => x.name?.toLowerCase() === name.toLowerCase()
  );
  return h?.value ?? null;
}

export interface DisneyMessage {
  message_id: string | null;
  snippet: string | null;
  subject: string | null;
  sender_email: string | null;
  otp_code: string | null;
  received_at: string | null; // ISO (UTC)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMessage(full: any): DisneyMessage {
  const payload = full.payload;
  const bodies = extractBodies(payload);
  const combined = [
    header(payload, 'Subject'),
    full.snippet,
    bodies.text,
    bodies.html ? bodies.html.replace(/<[^>]+>/g, ' ') : null,
  ]
    .filter(Boolean)
    .join('\n');
  const match = combined.match(/\b\d{4,6}\b/);
  return {
    message_id: full.id ?? null,
    snippet: full.snippet ?? null,
    subject: header(payload, 'Subject'),
    sender_email: header(payload, 'From'),
    otp_code: match ? match[0] : null,
    received_at: full.internalDate ? new Date(Number(full.internalDate)).toISOString() : null,
  };
}

export async function fetchLatestDisneyMessage(
  tokens: { access_token: string | null; refresh_token: string | null; expires_at: string | null },
  onTokenRefresh?: (t: { access_token: string; expiry_date: number | null }) => Promise<void>
): Promise<DisneyMessage | null> {
  const auth = makeOAuthClient();
  auth.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expires_at ? new Date(tokens.expires_at).getTime() : undefined,
  });

  // Simpan access token baru saat library otomatis me-refresh
  if (onTokenRefresh) {
    auth.on('tokens', (t) => {
      if (t.access_token) {
        void onTokenRefresh({ access_token: t.access_token, expiry_date: t.expiry_date ?? null });
      }
    });
  }

  const gmail = google.gmail({ version: 'v1', auth });
  const opts = { timeout: GMAIL_TIMEOUT_MS };

  const q = 'newer_than:2d (Disney OR "Disney+" OR kode OR verifikasi OR OTP)';
  const list = await gmail.users.messages.list({ userId: 'me', maxResults: 5, q }, opts);
  const messages = list.data.messages || [];
  if (messages.length === 0) return null;

  for (const item of messages) {
    const full = await gmail.users.messages.get(
      { userId: 'me', id: item.id!, format: 'full' },
      opts
    );
    const parsed = parseMessage(full.data);
    if (parsed.otp_code) return parsed; // berhenti di email pertama yang ada kodenya
  }

  // fallback: email pertama walau kode belum terbaca
  const first = await gmail.users.messages.get(
    { userId: 'me', id: messages[0].id!, format: 'full' },
    opts
  );
  return parseMessage(first.data);
}
