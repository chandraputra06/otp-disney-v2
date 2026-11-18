import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_COOKIE = 'orinimo_google_connect';

function secret(value = process.env.OAUTH_STATE_SECRET) {
  if (!value || value.length < 32 || value.startsWith('REPLACE_')) throw new Error('oauth_secret_missing');
  return value;
}

function equal(a, b) {
  const one = Buffer.from(String(a || ''));
  const two = Buffer.from(String(b || ''));
  return one.length === two.length && timingSafeEqual(one, two);
}

export function createOAuthState(accountId, userId, { now = Date.now(), signingSecret } = {}) {
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const body = Buffer.from(JSON.stringify({ accountId, userId, nonce, verifier, expires: now + 600_000 })).toString('base64url');
  const signature = createHmac('sha256', secret(signingSecret)).update(body).digest('base64url');
  return { state: nonce, challenge: createHash('sha256').update(verifier).digest('base64url'), cookie: body + '.' + signature };
}

export function verifyOAuthState(cookie, state, userId, { now = Date.now(), signingSecret } = {}) {
  if (!cookie || cookie.length > 3000 || !state) throw new Error('invalid_oauth_state');
  const [body, signature, extra] = cookie.split('.');
  if (extra || !equal(signature, createHmac('sha256', secret(signingSecret)).update(body).digest('base64url'))) throw new Error('invalid_oauth_state');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!equal(state, data.nonce) || data.userId !== userId || data.expires <= now) throw new Error('invalid_oauth_state');
  return data;
}
