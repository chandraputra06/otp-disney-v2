import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLatestDisneyOtp } from '../lib/google.js';
import { email, response, NOW, RECIPIENT } from './fixtures.js';

const config = { clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost/callback' };
const token = { access_token: 'test-access', refresh_token: 'test-refresh', expires_at: new Date(NOW + 3600_000).toISOString(), gmail_email: RECIPIENT };

test('uses exact senders and an epoch filter, reads bodies in parallel, picks newest', async () => {
  const calls = [];
  let inFlight = 0, maxParallel = 0;
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    if (url.includes('/messages?')) {
      const q = new URL(url).searchParams.get('q');
      assert.match(q, /from:disneyplus@trx.mail2.disneyplus.com/);
      assert.match(q, /after:\d+/);
      return response({ messages: [{ id:'old' },{ id:'new' }] });
    }
    inFlight++; maxParallel = Math.max(maxParallel, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10)); inFlight--;
    return response(url.includes('/old?') ? email({ id:'old',code:'111111',received:NOW-100_000 }) : email({ id:'new',code:'917309',received:NOW-1_000 }));
  };
  const result = await fetchLatestDisneyOtp({ token, recipient: RECIPIENT, now: NOW, config, fetchImpl });
  assert.equal(result.otp_code,'917309'); assert.equal(maxParallel,2); assert.equal(calls.length,3);
});
test('awaits refreshed token persistence before Gmail calls', async () => {
  let persisted = false;
  const fetchImpl = async (url, options) => {
    if (url.includes('/token')) {
      assert.equal(options.body.get('grant_type'),'refresh_token');
      return response({ access_token:'new-access',expires_in:3600 });
    }
    assert.equal(persisted,true); assert.equal(options.headers.Authorization,'Bearer new-access');
    return response({ messages:[] });
  };
  await fetchLatestDisneyOtp({ token:{ ...token,expires_at:null },recipient:RECIPIENT,now:NOW,config,fetchImpl,onTokenRefresh:async (values) => {
    await Promise.resolve(); assert.equal(values.refresh_token,'test-refresh'); persisted = true;
  } });
});
test('verifies legacy connections using Gmail profile before searching emails', async () => {
  let verified = '';
  await fetchLatestDisneyOtp({ token:{ ...token,gmail_email:null },recipient:RECIPIENT,now:NOW,config,
    onMailboxVerified:async (email) => { verified = email; },
    fetchImpl:async (url) => url.endsWith('/profile') ? response({ emailAddress:RECIPIENT }) : response({ messages:[] }),
  });
  assert.equal(verified,RECIPIENT);
});
test('refuses a token linked to a different mailbox before listing', async () => {
  let calls=0;
  await assert.rejects(fetchLatestDisneyOtp({token:{ ...token,gmail_email:'wrong@example.com' },recipient:RECIPIENT,now:NOW,config,fetchImpl:async()=>{calls++;}}), /account_mismatch/);
  assert.equal(calls,0);
});
test('invalid_grant becomes reconnect_required', async () => {
  await assert.rejects(fetchLatestDisneyOtp({token:{ ...token,expires_at:null },recipient:RECIPIENT,now:NOW,config,fetchImpl:async()=>response({error:'invalid_grant'},400)}), /reconnect_required/);
});
test('refreshes once after 401 then retries the original request', async () => {
  let refreshed = false, listed=0;
  const result = await fetchLatestDisneyOtp({token,recipient:RECIPIENT,now:NOW,config,fetchImpl:async(url)=>{
    if(url.includes('/token')) { refreshed=true;return response({ access_token:'new',expires_in:3600 }); }
    listed++;return refreshed ? response({ messages:[] }) : response({},401);
  }});
  assert.equal(result.status,'not_found'); assert.equal(listed,2);
});
test('does not return old OTP if any candidate body cannot be read', async () => {
  await assert.rejects(fetchLatestDisneyOtp({token,recipient:RECIPIENT,now:NOW,config,fetchImpl:async(url)=>{
    if(url.includes('/messages?')) return response({messages:[{id:'old'},{id:'new'}]});
    return url.includes('/old?') ? response(email()) : response({},503);
  }}), /google_unavailable/);
});
test('rejects truncated/paginated candidate sets rather than guessing newest', async () => {
  await assert.rejects(fetchLatestDisneyOtp({token,recipient:RECIPIENT,now:NOW,config,fetchImpl:async()=>response({messages:[{id:'old'}],nextPageToken:'more'})}), /too_many_messages/);
});
