import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOtp, selectLatestOtp, mailboxIdentity } from '../lib/otp-parser.js';
import { email, NOW, RECIPIENT } from './fixtures.js';
const select = (messages) => selectLatestOtp(messages, { recipient: RECIPIENT, now: NOW });

test('reads the English example from the body, never an older Gmail snippet', () => {
  const message = email({ subject: 'Your one-time passcode for Disney+', snippet: 'Old code 999999', text: "Here's your one-time passcode for Disney+\nUse this passcode to verify the email address associated with your MyDisney account. It will expire in 15 minutes.\n\n129534\n\nIf you did not make this request, please visit our Help Centre." });
  assert.equal(select([message]).otp_code, '129534');
});
for (const code of ['703401','917309','003401']) test('reads the Indonesian template and preserves all six digits: ' + code, () => assert.equal(extractOtp(email({ code }).payload), code));
test('does not mistake a year, CSS color, reference URL or snippet for an OTP', () => {
  const message = email({ text: null, snippet: 'Old 123456', html: '<style>.x{color:#123456}</style><h1>Berikut kode OTP Anda untuk Disney+</h1><p>© 2026</p><p style="color:#112233">703401</p><a href="https://example.com/999999">Pusat Bantuan</a>' });
  assert.equal(extractOtp(message.payload), '703401');
});
test('handles six digits split into HTML cells', () => {
  const html = '<p>Kode OTP Anda untuk Disney+</p><table><tr>' + '003401'.split('').map((n) => '<td>' + n + '</td>').join('') + '</tr></table>';
  assert.equal(extractOtp(email({ text: null, html }).payload), '003401');
});
test('rejects a snippet-only code', () => assert.equal(extractOtp(email({ text: '', snippet: 'OTP 123456' }).payload), null));
test('does not combine a year and a separate two-digit number into a code', () => {
  for (const text of ['Kode OTP\n2026\n15', 'Kode OTP 2026 15']) assert.equal(extractOtp(email({ text }).payload), null);
  assert.equal(extractOtp(email({ text: 'Kode OTP\r\n703401\r\n' }).payload), '703401');
});
test('rejects 4-digit and 7-digit numbers', () => {
  for (const text of ['Kode OTP 2026', 'Kode OTP 1234567','Kode OTP\n1234567','Kode OTP\n1 2 3 4 5 6 7']) assert.equal(extractOtp(email({ text }).payload), null);
});
test('rejects conflicting codes in text and HTML', () => assert.equal(extractOtp(email({ code: '111111', html: '<p>Kode OTP Anda</p><p>222222</p>' }).payload), null));
test('ignores attachments, forwarded messages and HTML quoted replies', () => {
  const attached = email({ code: '999999' }).payload.parts[0];
  attached.filename = 'old.txt';
  assert.equal(extractOtp(email({ text: null, html: '<p>Kode OTP</p><p>703401</p><blockquote><p>999999</p></blockquote>', parts: [attached, { mimeType: 'message/rfc822', parts: email({ code: '888888' }).payload.parts }] }).payload), '703401');
});
test('rejects another sender with the same Disney subject', () => assert.equal(select([email({ sender: 'fake@example.com' })]).status, 'not_found'));
test('rejects another recipient', () => assert.equal(select([email({ recipient: 'account.two@example.com' })]).status, 'not_found'));
test('rejects non-OTP subjects', () => assert.equal(select([email({ subject: 'Your Disney+ invoice' })]).status, 'not_found'));
test('sorts individual messages by internalDate, not list order or thread snippet', () => {
  const result = select([email({ id: 'old', code: '111111', received: NOW - 300_000 }), email({ id: 'new', code: '222222', received: NOW - 10_000 })]);
  assert.equal(result.otp_code,'222222'); assert.equal(result.message_id, 'new');
});
test('never falls back to an older code when the newest email is unparseable', () => {
  assert.equal(select([email({ id: 'old' }), email({ id: 'new', text: 'Kode OTP belum dapat dibaca', received: NOW - 1_000 })]).status, 'parse_failed');
});
test('expires exactly at 15 minutes', () => {
  assert.equal(select([email({ received: NOW - 900_000 })]).status, 'expired');
  assert.equal(select([email({ received: NOW - 899_999 })]).status, 'success');
});
test('rejects invalid/future timestamps and conflicting equal timestamps', () => {
  assert.equal(select([email({ received: NaN })]).status, 'parse_failed');
  assert.equal(select([email({ received: NOW + 120_000 })]).status, 'parse_failed');
  assert.equal(select([email({ id: 'one', code: '111111' }), email({ id: 'two', code: '222222' })]).status, 'parse_failed');
});
test('recognizes Gmail mailbox aliases while recipients remain distinct', () => {
  assert.equal(mailboxIdentity('Pop.Corn+disney@gmail.com'), 'popcorn@gmail.com');
  const result = selectLatestOtp([email({ recipient: 'popcorn+two@gmail.com' })], { recipient: 'popcorn+one@gmail.com', now: NOW });
  assert.equal(result.status, 'not_found');
});
test('Delivered-To cannot override a different explicit recipient alias', () => {
  const message = email({ recipient: 'popcorn+two@gmail.com' });
  message.payload.headers.push({ name: 'Delivered-To', value: 'popcorn@gmail.com' });
  assert.equal(selectLatestOtp([message], { recipient: 'popcorn@gmail.com', now: NOW }).status, 'not_found');
});
