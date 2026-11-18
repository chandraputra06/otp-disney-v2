import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOtp, selectLatestOtp, mailboxIdentity } from '../lib/otp-parser.js';
import { email, NOW, RECIPIENT } from './fixtures.js';

const select = (messages) => selectLatestOtp(messages, { recipient: RECIPIENT, now: NOW });

test('reads the English example from the body, never an older Gmail snippet', () => {
  const message = email({
    subject: 'Your one-time passcode for Disney+',
    snippet: 'Old code 999999',
    text: "Here's your one-time passcode for Disney+\nUse this passcode to verify the email address associated with your MyDisney account. It will expire in 15 minutes.\n\n041752\n\nIf you did not make this request, please visit our Help Centre.",
  });

  assert.equal(select([message]).otp_code, '041752');
});

for (const code of ['615802', '809341', '003401']) {
  test('reads the Indonesian template and preserves all six digits: ' + code, () => {
    assert.equal(extractOtp(email({ code }).payload), code);
  });
}

test('does not mistake a year, CSS color, reference URL or snippet for an OTP', () => {
  const message = email({
    text: null,
    snippet: 'Old 123456',
    html: '<style>.x{color:#123456}</style><h1>Berikut kode OTP Anda untuk Disney+</h1><p>© 2026</p><p style="color:#112233">615802</p><a href="https://example.com/999999">Pusat Bantuan</a>',
  });

  assert.equal(extractOtp(message.payload), '615802');
});

test('handles six digits split into HTML cells', () => {
  const html = '<p>Kode OTP Anda untuk Disney+</p><table><tr>' +
    '003401'.split('').map((digit) => '<td>' + digit + '</td>').join('') +
    '</tr></table>';

  assert.equal(extractOtp(email({ text: null, html }).payload), '003401');
});

test('rejects a snippet-only code', () => {
  assert.equal(extractOtp(email({ text: '', snippet: 'OTP 123456' }).payload), null);
});

test('does not combine a year and a separate two-digit number into a code', () => {
  for (const text of ['Kode OTP\n2026\n15', 'Kode OTP 2026 15']) {
    assert.equal(extractOtp(email({ text }).payload), null);
  }

  assert.equal(extractOtp(email({ text: 'Kode OTP\r\n615802\r\n' }).payload), '615802');
});

test('rejects 4-digit and 7-digit numbers', () => {
  for (const text of [
    'Kode OTP 2026', 'Kode OTP 1234567', 'Kode OTP\n1234567', 'Kode OTP\n1 2 3 4 5 6 7',
  ]) {
    assert.equal(extractOtp(email({ text }).payload), null);
  }
});

test('rejects conflicting codes in text and HTML', () => {
  const message = email({ code: '111111', html: '<p>Kode OTP Anda</p><p>222222</p>' });
  assert.equal(extractOtp(message.payload), null);
});

test('ignores attachments, forwarded messages and HTML quoted replies', () => {
  const attached = email({ code: '999999' }).payload.parts[0];
  attached.filename = 'old.txt';

  const message = email({
    text: null,
    html: '<p>Kode OTP</p><p>615802</p><blockquote><p>999999</p></blockquote>',
    parts: [
      attached,
      { mimeType: 'message/rfc822', parts: email({ code: '888888' }).payload.parts },
    ],
  });

  assert.equal(extractOtp(message.payload), '615802');
});

test('rejects another sender with the same Disney subject', () => {
  assert.equal(select([email({ sender: 'fake@example.com' })]).status, 'not_found');
});

test('rejects another recipient', () => {
  assert.equal(select([email({ recipient: 'account.two@example.com' })]).status, 'not_found');
});

test('rejects non-OTP subjects', () => {
  assert.equal(select([email({ subject: 'Your Disney+ invoice' })]).status, 'not_found');
});

test('sorts individual messages by internalDate, not list order or thread snippet', () => {
  const result = select([
    email({ id: 'old', code: '111111', received: NOW - 300_000 }),
    email({ id: 'new', code: '222222', received: NOW - 10_000 }),
  ]);

  assert.equal(result.otp_code, '222222');
  assert.equal(result.message_id, 'new');
});

test('never falls back to an older code when the newest email is unparseable', () => {
  const result = select([
    email({ id: 'old' }),
    email({ id: 'new', text: 'Kode OTP belum dapat dibaca', received: NOW - 1_000 }),
  ]);

  assert.equal(result.status, 'parse_failed');
});

test('expires exactly at 15 minutes', () => {
  assert.equal(select([email({ received: NOW - 900_000 })]).status, 'expired');
  assert.equal(select([email({ received: NOW - 899_999 })]).status, 'success');
});

test('rejects invalid/future timestamps and conflicting equal timestamps', () => {
  assert.equal(select([email({ received: NaN })]).status, 'parse_failed');
  assert.equal(select([email({ received: NOW + 120_000 })]).status, 'parse_failed');

  const result = select([
    email({ id: 'one', code: '111111' }),
    email({ id: 'two', code: '222222' }),
  ]);

  assert.equal(result.status, 'parse_failed');
});

test('recognizes Gmail mailbox aliases while recipients remain distinct', () => {
  assert.equal(mailboxIdentity('Pop.Corn+disney@gmail.com'), 'popcorn@gmail.com');

  const result = selectLatestOtp(
    [email({ recipient: 'popcorn+two@gmail.com' })],
    { recipient: 'popcorn+one@gmail.com', now: NOW }
  );

  assert.equal(result.status, 'not_found');
});

test('Delivered-To cannot override a different explicit recipient alias', () => {
  const message = email({ recipient: 'popcorn+two@gmail.com' });
  message.payload.headers.push({ name: 'Delivered-To', value: 'popcorn@gmail.com' });

  assert.equal(
    selectLatestOtp([message], { recipient: 'popcorn@gmail.com', now: NOW }).status,
    'not_found'
  );
});

test('distinguishes an empty Gmail result, a filtered message and a dotted recipient', () => {
  const configured = 'pop.corn@gmail.com';
  const lookup = (messages) => selectLatestOtp(messages, { recipient: configured, now: NOW });

  assert.deepEqual(lookup([]), { status: 'not_found', search_detail: 'empty' });

  assert.deepEqual(lookup([email({ recipient: configured, subject: 'Your Disney+ invoice' })]),
    { status: 'not_found', search_detail: 'subject' });

  assert.deepEqual(lookup([email({ recipient: configured, sender: 'someone@example.invalid' })]),
    { status: 'not_found', search_detail: 'sender' });

  assert.deepEqual(lookup([email({ recipient: 'popcorn@gmail.com' })]),
    { status: 'recipient_spelling' });

  assert.equal(lookup([email({ recipient: configured })]).status, 'success');

  assert.deepEqual(lookup([email({ recipient: 'popcorn+two@gmail.com' })]),
    { status: 'not_found', search_detail: 'recipient' });

  assert.deepEqual(lookup([email({ recipient: 'popcorn@gmail.com', received: NOW - 900_000 })]),
    { status: 'not_found', search_detail: 'recipient' });
});

test('a newer dotted spelling blocks a stale exact match and never yields its code', () => {
  const recipient = 'pop.corn@gmail.com';
  const alias = email({ id: 'alias', recipient: 'popcorn@gmail.com', received: NOW - 3000 });
  const exact = email({ id: 'exact', recipient, received: NOW - 6000 });

  assert.deepEqual(selectLatestOtp([exact, alias], { recipient, now: NOW }),
    { status: 'recipient_spelling' });

  exact.internalDate = String(NOW - 1000);

  assert.equal(selectLatestOtp([alias, exact], { recipient, now: NOW }).message_id, 'exact');

  const customDomain = selectLatestOtp(
    [email({ recipient: 'popcorn@example.org' })],
    { recipient: 'pop.corn@example.org', now: NOW }
  );

  assert.equal(customDomain.search_detail, 'recipient');
});

test('decodes folded RFC 2047 titles, with the exact recipient still required', () => {
  const subject = '=?UTF-8?Q?Your_one=E2=80=91time_passcode_?=\r\n =?UTF-8?B?' +
    Buffer.from('for Disney+').toString('base64') + '?=';

  assert.equal(select([email({ subject })]).status, 'success');
  assert.equal(select([email({ subject, recipient: 'other@example.net' })]).search_detail, 'recipient');
});

test('reads the code between the expiry and help text in nested layout tables', () => {
  const html = '<table role="presentation"><tr><td><table><tr>' +
    '<td>It will expire in 15 minutes.</td><td style="color:#723901"><b>048271</b></td>' +
    '<td>If you did not make this request, visit <a href="https://example.invalid/561234">Help Centre</a>.</td>' +
    '</tr></table></td></tr></table><div style="display: none">597301</div>';

  const message = email({
    subject: 'Your one-time passcode for Disney+',
    text: null,
    html,
    snippet: 'Old 781204',
  });

  const result = select([
    email({ id: 'older', code: '652980', received: NOW - 180_000 }),
    message,
  ]);

  assert.equal(result.message_id, message.id);
  assert.equal(result.otp_code, '048271');
});

test('reads inline English and Indonesian templates and invisible digit separators', () => {
  const en = 'It will expire in 15 minutes. 0\u202f4\u20608\u00ad2\u200b7\u00a01 If you did not make this request';
  const id = '<span>Kode OTP akan kedaluwarsa dalam 15 menit.</span><b>048271</b><span>Jika Anda tidak membuat permintaan ini</span>';

  assert.equal(select([email({ text: en, html: id })]).otp_code, '048271');

  const different = select([email({ text: en, html: id.replace('048271', '302918') })]);
  assert.equal(different.parse_detail, 'ambiguous');
  assert.equal(different.otp_code, undefined);
});

test('isolates the verification card from six-digit footer numbers in the same MIME part', () => {
  const text = 'It will expire in 15 minutes. 048271 If you did not make this request, visit our Help Centre.\nMore convenience. More joy.\n740182';

  assert.equal(select([email({ text })]).otp_code, '048271');

  const conflicting = '<p>Kode OTP akan kedaluwarsa dalam 15 menit. 581724 Jika Anda tidak membuat permintaan ini, kunjungi Pusat Bantuan.</p>';
  assert.equal(select([email({ text, html: conflicting })]).parse_detail, 'ambiguous');
});

test('rejects seven vertically split digits, URL references and narrative text without a code', () => {
  for (const text of [
    '1\n2\n3\n4\n5\n6\n7',
    'Passcode https://example.invalid/help/530128',
    'It will expire in 15 minutes. Reference: 530128',
    'It will expire in 15 minutes. 1234567 If you need help',
  ]) {
    assert.equal(select([email({ text })]).parse_detail, 'format');
  }
});