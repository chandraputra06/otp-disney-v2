import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLatestDisneyOtp } from '../lib/google.js';
import { email, response, NOW, RECIPIENT } from './fixtures.js';

const config = {
  clientId: 'test',
  clientSecret: 'test',
  redirectUri: 'http://localhost/callback',
};

const token = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: new Date(NOW + 3600_000).toISOString(),
  gmail_email: RECIPIENT,
};

test('uses exact senders and an epoch filter, reads bodies in parallel, picks newest', async () => {
  const calls = [];
  let inFlight = 0;
  let maxParallel = 0;

  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);

    if (url.includes('/messages?')) {
      const q = new URL(url).searchParams.get('q');
      assert.match(q, /from:disneyplus@trx.mail2.disneyplus.com/);
      assert.match(q, /after:\d+/);
      return response({ messages: [{ id: 'old' }, { id: 'new' }] });
    }

    inFlight++;
    maxParallel = Math.max(maxParallel, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight--;

    return response(url.includes('/old?')
      ? email({ id: 'old', code: '111111', received: NOW - 100_000 })
      : email({ id: 'new', code: '809341', received: NOW - 1_000 }));
  };

  const result = await fetchLatestDisneyOtp({ token, recipient: RECIPIENT, now: NOW, config, fetchImpl });

  assert.equal(result.otp_code, '809341');
  assert.equal(maxParallel, 2);
  assert.equal(calls.length, 3);
});

test('awaits refreshed token persistence before Gmail calls', async () => {
  let persisted = false;

  const fetchImpl = async (url, options) => {
    if (url.includes('/token')) {
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      return response({ access_token: 'new-access', expires_in: 3600 });
    }

    assert.equal(persisted, true);
    assert.equal(options.headers.Authorization, 'Bearer new-access');
    return response({ messages: [] });
  };

  await fetchLatestDisneyOtp({
    token: { ...token, expires_at: null },
    recipient: RECIPIENT,
    now: NOW,
    config,
    fetchImpl,
    onTokenRefresh: async (values) => {
      await Promise.resolve();
      assert.equal(values.refresh_token, 'test-refresh');
      persisted = true;
    },
  });
});

test('verifies legacy connections using Gmail profile before searching emails', async () => {
  let verified = '';

  await fetchLatestDisneyOtp({
    token: { ...token, gmail_email: null },
    recipient: RECIPIENT,
    now: NOW,
    config,
    onMailboxVerified: async (address) => { verified = address; },
    fetchImpl: async (url) => url.endsWith('/profile')
      ? response({ emailAddress: RECIPIENT })
      : response({ messages: [] }),
  });

  assert.equal(verified, RECIPIENT);
});

test('refuses a token linked to a different mailbox before listing', async () => {
  let calls = 0;

  await assert.rejects(fetchLatestDisneyOtp({
    token: { ...token, gmail_email: 'wrong@example.com' },
    recipient: RECIPIENT,
    now: NOW,
    config,
    fetchImpl: async () => { calls++; },
  }), /account_mismatch/);

  assert.equal(calls, 0);
});

test('invalid_grant becomes reconnect_required', async () => {
  await assert.rejects(fetchLatestDisneyOtp({
    token: { ...token, expires_at: null },
    recipient: RECIPIENT,
    now: NOW,
    config,
    fetchImpl: async () => response({ error: 'invalid_grant' }, 400),
  }), /reconnect_required/);
});

test('refreshes once after 401 then retries the original request', async () => {
  let refreshed = false;
  let listed = 0;

  const result = await fetchLatestDisneyOtp({
    token, recipient: RECIPIENT, now: NOW, config,
    fetchImpl: async (url) => {
      if (url.includes('/token')) {
        refreshed = true;
        return response({ access_token: 'new', expires_in: 3600 });
      }

      listed++;
      return refreshed ? response({ messages: [] }) : response({}, 401);
    },
  });

  assert.equal(result.status, 'not_found');
  assert.equal(listed, 2);
});

test('does not return old OTP if any candidate body cannot be read', async () => {
  await assert.rejects(fetchLatestDisneyOtp({
    token, recipient: RECIPIENT, now: NOW, config,
    fetchImpl: async (url) => {
      if (url.includes('/messages?')) return response({ messages: [{ id: 'old' }, { id: 'new' }] });
      return url.includes('/old?') ? response(email()) : response({}, 503);
    },
  }), /google_unavailable/);
});

test('rejects truncated/paginated candidate sets rather than guessing newest', async () => {
  await assert.rejects(fetchLatestDisneyOtp({
    token, recipient: RECIPIENT, now: NOW, config,
    fetchImpl: async () => response({ messages: [{ id: 'old' }], nextPageToken: 'more' }),
  }), /too_many_messages/);
});

test('loads only inline text of the newest eligible message when Gmail stores the body separately', async () => {
  const html = '<table><tr><td>Kode OTP akan kedaluwarsa dalam 15 menit.</td><td>059062</td><td>Jika Anda tidak membuat permintaan ini</td></tr></table>';
  const bytes = Buffer.from(html);

  const external = (attachmentId) => ({
    mimeType: 'text/html',
    body: { attachmentId, size: bytes.length },
  });

  const newest = email({
    id: 'fresh',
    text: null,
    received: NOW - 1000,
    parts: [
      external('inline-body'),
      { ...external('named'), filename: 'mail.html' },
      { ...external('attached'), headers: [{ name: 'Content-Disposition', value: 'attachment' }] },
      { mimeType: 'message/rfc822', parts: [external('forwarded')] },
    ],
  });

  const older = email({ id: 'older', text: null, parts: [external('old-body')] });

  const other = email({
    id: 'foreign', recipient: 'other@example.invalid', received: NOW - 1000,
    text: null, parts: [external('foreign-body')],
  });

  const calls = [];

  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;

    if (path.endsWith('/messages')) {
      return response({ messages: [older, newest, other].map(({ id }) => ({ id })) });
    }

    if (path.includes('/attachments/')) {
      calls.push(path);
      return response({ size: bytes.length, data: bytes.toString('base64url') });
    }

    return response([older, newest, other].find(({ id }) => path.endsWith('/' + id)));
  };

  const result = await fetchLatestDisneyOtp({ token, recipient: RECIPIENT, config, now: NOW, fetchImpl });

  assert.equal(result.otp_code, '059062');
  assert.equal(result.message_id, 'fresh');
  assert.deepEqual(calls, ['/gmail/v1/users/me/messages/fresh/attachments/inline-body']);
});

test('does not use an older code when the selected inline body is too large or truncated', async () => {
  for (const size of [42, 1_500_000]) {
    const newest = email({
      id: 'fresh',
      received: NOW - 1000,
      text: null,
      parts: [{ mimeType: 'text/html', body: { size, attachmentId: 'missing' } }],
    });

    const fetchImpl = async (url) => {
      if (url.includes('/messages?')) {
        return response({ messages: [{ id: 'old' }, { id: 'fresh' }] });
      }

      if (url.includes('/attachments/')) {
        assert.equal(size, 42);
        return response({ size: 42, data: 'YQ' });
      }

      return response(url.includes('/fresh?') ? newest : email({ id: 'old' }));
    };

    const result = await fetchLatestDisneyOtp({ token, recipient: RECIPIENT, config, now: NOW, fetchImpl });

    assert.equal(result.parse_detail, 'body_unavailable');
    assert.equal(result.message_id, 'fresh');
    assert.equal(result.otp_code, undefined);
  }
});