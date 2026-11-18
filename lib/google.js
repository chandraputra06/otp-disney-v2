import {
  DEFAULT_SENDERS,
  inlineTextParts,
  mailboxIdentity,
  matchesDisneyMessage,
  MAX_INLINE_TEXT_BYTES,
  selectLatestOtp,
  validEmail,
} from './otp-parser.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export class GoogleError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'GoogleError';
    this.code = code;
    this.status = status;
  }
}

export function googleConfig(env = process.env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new GoogleError('configuration_error');
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

export function authorizationUrl({ state, challenge, email }, config = googleConfig()) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    login_hint: email,
  }).toString();

  return url.toString();
}

async function tokenRequest(params, { config = googleConfig(), fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    cache: 'no-store',
    signal: signal || AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...params,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new GoogleError(
      data.error === 'invalid_grant' ? 'reconnect_required' : 'google_unavailable',
      response.status
    );
  }

  return data;
}

export function exchangeCode(code, verifier, options) {
  const config = options?.config || googleConfig();

  return tokenRequest({
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  }, { ...options, config });
}

export async function gmailProfile(accessToken, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(GMAIL_URL + '/profile', {
    headers: { Authorization: 'Bearer ' + accessToken },
    cache: 'no-store',
    signal: signal || AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new GoogleError('profile_failed', response.status);

  const data = await response.json();
  if (!validEmail(data.emailAddress)) throw new GoogleError('profile_failed');

  return data.emailAddress.toLowerCase();
}

export async function fetchLatestDisneyOtp({
  token,
  recipient,
  onTokenRefresh,
  onMailboxVerified,
  now = Date.now(),
  fetchImpl = fetch,
  config = googleConfig(),
  senders = (process.env.DISNEY_OTP_SENDERS || DEFAULT_SENDERS.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
}) {
  if (!validEmail(recipient) || !senders.length || senders.some((value) => !validEmail(value))) {
    throw new GoogleError('configuration_error');
  }

  const signal = AbortSignal.timeout(12_000);
  let accessToken = token.access_token;
  let refreshed = false;

  async function refresh() {
    if (!token.refresh_token || refreshed) throw new GoogleError('reconnect_required', 401);

    const data = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }, { config, fetchImpl, signal });

    accessToken = data.access_token;
    refreshed = true;

    await onTokenRefresh?.({
      access_token: data.access_token,
      refresh_token: data.refresh_token || token.refresh_token,
      expires_at: new Date(now + Number(data.expires_in || 3600) * 1000).toISOString(),
    });
  }

  if (!accessToken || !token.expires_at || Date.parse(token.expires_at) <= now + 60_000) {
    await refresh();
  }

  async function request(path, retry = true) {
    const response = await fetchImpl(GMAIL_URL + path, {
      headers: { Authorization: 'Bearer ' + accessToken },
      cache: 'no-store',
      signal,
    });

    if (response.status === 401 && retry && !refreshed) {
      await refresh();
      return request(path, false);
    }

    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? 'reconnect_required'
        : 'google_unavailable';

      throw new GoogleError(code, response.status);
    }

    return response.json();
  }

  let mailbox = token.gmail_email;

  if (!mailbox) {
    const profile = await request('/profile');
    mailbox = profile.emailAddress;

    if (!validEmail(mailbox)) throw new GoogleError('profile_failed');
    if (mailboxIdentity(mailbox) !== mailboxIdentity(recipient)) {
      throw new GoogleError('account_mismatch');
    }

    await onMailboxVerified?.(mailbox.toLowerCase());
  }

  if (mailboxIdentity(mailbox) !== mailboxIdentity(recipient)) {
    throw new GoogleError('account_mismatch');
  }

  const senderQuery = '{' + senders.map((sender) => 'from:' + sender).join(' ') + '}';
  const q = senderQuery + ' after:' + Math.floor((now - 16 * 60 * 1000) / 1000);

  const params = new URLSearchParams({
    q,
    maxResults: '25',
    includeSpamTrash: 'false',
    fields: 'messages(id),nextPageToken',
  });

  const listed = await request('/messages?' + params);
  if (listed.nextPageToken) throw new GoogleError('too_many_messages');

  const ids = [...new Set((listed.messages || []).map((item) => item.id).filter(Boolean))];
  const messages = [];

  for (let start = 0; start < ids.length; start += 5) {
    const batch = await Promise.all(
      ids.slice(start, start + 5).map((id) =>
        request('/messages/' + encodeURIComponent(id) + '?format=full')
      )
    );
    messages.push(...batch);
  }

  const options = { recipient, senders, now };
  const result = selectLatestOtp(messages, options);

  if (result.parse_detail !== 'body_unavailable' || !result.received_at) {
    return result;
  }

  // Gmail kadang menyimpan isi teks pesan secara terpisah.
  const received = Date.parse(result.received_at);
  const pending = [];
  let bytes = 0;

  for (const message of messages) {
    if (
      Number(message.internalDate) !== received ||
      !matchesDisneyMessage(message, recipient, senders)
    ) {
      continue;
    }

    for (const { part } of inlineTextParts(message.payload)) {
      const body = part.body;

      if (body?.data || !body?.attachmentId) continue;
      if (!Number.isSafeInteger(body.size) || body.size <= 0) return result;

      bytes += body.size;
      pending.push({ id: message.id, body });
    }
  }

  if (!pending.length || pending.length > 5 || bytes > MAX_INLINE_TEXT_BYTES) {
    return result;
  }

  await Promise.all(pending.map(async ({ id, body }) => {
    const path = '/messages/' + encodeURIComponent(id) +
      '/attachments/' + encodeURIComponent(body.attachmentId);

    const data = await request(path + '?fields=data,size');

    if (
      typeof data.data === 'string' &&
      data.size === body.size &&
      data.data.length <= Math.ceil(body.size / 3) * 4 &&
      Buffer.from(data.data, 'base64url').length === body.size
    ) {
      body.data = data.data;
    }
  }));

  return selectLatestOtp(messages, options);
}