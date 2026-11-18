import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOtpForPhone } from '../lib/otp-service.js';
import { phoneVariants, canonicalPhone } from '../lib/phone.js';
import { NOW } from './fixtures.js';

const good = {
  status: 'success',
  otp_code: '003401',
  message_id: 'new',
  received_at: new Date(NOW - 1_000).toISOString(),
  expires_at: new Date(NOW + 899_000).toISOString(),
};

const account = {
  id: 'account',
  label: 'Disney 01',
  disney_email: 'account@example.com',
  token: { access_token: 'access', connection_version: 'v1' },
};

function deps(extra = {}) {
  return {
    clock: () => NOW,
    repo: {
      findAccounts: async () => [account],
      claim: async () => ({ acquired: true }),
      updateToken: async () => {},
      finish: async () => true,
    },
    readGmail: async () => good,
    ...extra,
  };
}

test('normalizes Indonesian formats and retains international mappings', () => {
  assert.deepEqual(phoneVariants('+62 812-3456-7890'), ['6281234567890', '081234567890']);
  assert.equal(canonicalPhone('081234567890'), '6281234567890');
  assert.equal(canonicalPhone('886529367891'), '886529367891');
  assert.deepEqual(phoneVariants('a081234567890'), []);
  assert.deepEqual(phoneVariants({ phone: '081234567890' }), []);
});

test('blocks ambiguous phone mappings without fetching Gmail', async () => {
  const setup = deps();
  setup.repo.findAccounts = async () => [account, account];
  setup.readGmail = async () => assert.fail();

  assert.equal((await fetchOtpForPhone('081234567890', setup)).status, 'account_ambiguous');
});

test('requires explicit recipient setup before accessing legacy Gmail tokens', async () => {
  const setup = deps();
  setup.repo.findAccounts = async () => [{ ...account, disney_email: null }];
  setup.readGmail = async () => assert.fail();

  assert.equal((await fetchOtpForPhone('081234567890', setup)).status, 'setup_required');
});

test('honors atomic cooldown and exposes no cached old OTP', async () => {
  const setup = deps();
  setup.repo.claim = async () => ({ acquired: false, retry_after: 13 });
  setup.readGmail = async () => assert.fail();

  const result = await fetchOtpForPhone('081234567890', setup);

  assert.equal(result.status, 'cooldown');
  assert.equal(result.retry_after, 13);
  assert.equal(result.otp_code, null);
});

test('detects unchanged by message ID, not by repeated digits', async () => {
  const same = await fetchOtpForPhone('081234567890', deps({ previousMessageId: 'new' }));
  const newer = await fetchOtpForPhone('081234567890', deps({ previousMessageId: 'old' }));

  assert.equal(same.status, 'unchanged');
  assert.equal(newer.status, 'success');
});

test('does not display a code that expires during the network call', async () => {
  const result = await fetchOtpForPhone('081234567890', deps({ clock: () => NOW + 900_000 }));

  assert.equal(result.status, 'expired');
  assert.equal(result.otp_code, null);
});

test('rejects late results when an account connection changes during fetch', async () => {
  const setup = deps();
  setup.repo.finish = async () => false;

  const result = await fetchOtpForPhone('081234567890', setup);

  assert.equal(result.status, 'connection_changed');
  assert.equal(result.otp_code, null);
});

test('releases leases and returns no fallback on Gmail failures', async () => {
  let released = false;
  const setup = deps({ readGmail: async () => { throw new Error('private detail'); } });

  setup.repo.finish = async () => {
    released = true;
    return true;
  };

  const result = await fetchOtpForPhone('081234567890', setup);

  assert.equal(released, true);
  assert.equal(result.status, 'fetch_error');
  assert.equal(result.otp_code, null);
  assert.equal(JSON.stringify(result).includes('private detail'), false);
});

test('passes search and parse explanations through the API without leaking a code', async () => {
  const examples = [
    [{ status: 'not_found', search_detail: 'empty' }, /16 menit/],
    [{ status: 'not_found', search_detail: 'subject' }, /judul/],
    [{ status: 'recipient_spelling' }, /Kepada/],
    [{ status: 'parse_failed', parse_detail: 'body_unavailable' }, /isi teks/],
    [{ status: 'parse_failed', parse_detail: 'ambiguous' }, /satu kode/],
  ];

  for (const [outcome, explanation] of examples) {
    const result = await fetchOtpForPhone(
      '081234567890',
      deps({ readGmail: async () => outcome })
    );

    assert.equal(result.status, outcome.status);
    assert.match(result.message, explanation);
    assert.equal(result.otp_code, null);
  }
});