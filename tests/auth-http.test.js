import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOtpRequest } from '../lib/otp-http.js';
import { createOAuthState, verifyOAuthState } from '../lib/oauth-state.js';
import { isAdminUser } from '../lib/admin-policy.js';

const signingSecret='secret-for-tests-only-01234567890123456789';
const request=(body={phone_number:'081234567890'},headers={})=>new Request('https://orinimo.example/api/otp',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('API requires an authenticated admin before any account lookup',async()=>{
  const response=await handleOtpRequest(request(),{authenticate:async()=>null,fetchOtp:async()=>assert.fail()});
  assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);
});
test('rejects cross-origin credentialed requests',async()=>{
  const response=await handleOtpRequest(request(undefined,{origin:'https://evil.example'}),{authenticate:async()=>assert.fail()});
  assert.equal(response.status,403);
});
test('validates request fields and does not coerce objects to phone numbers',async()=>{
  const deps={authenticate:async()=>({id:'user'}),fetchOtp:async()=>assert.fail()};
  for(const body of [{phone_number:{}},{phone_number:'123'},{phone_number:'081234567890',previous_message_id:123}]) assert.equal((await handleOtpRequest(request(body),deps)).status,422);
});
test('returns actual Retry-After and hides internal database exceptions',async()=>{
  const deps={authenticate:async()=>true,fetchOtp:async()=>({status:'cooldown',retry_after:7,otp_code:null})};
  const response=await handleOtpRequest(request(),deps);
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'7');
  deps.fetchOtp=async()=>{throw new Error('sensitive-db-token');};
  const failed=await handleOtpRequest(request(),deps);
  assert.equal(failed.status,503);assert.equal((await failed.text()).includes('sensitive'),false);
});
test('does not treat editable user_metadata as an admin role',()=>{
  assert.equal(isAdminUser({id:'user',user_metadata:{role:'admin'}},{}),false);
  assert.equal(isAdminUser({id:'user',app_metadata:{role:'admin'}},{}),true);
  assert.equal(isAdminUser({id:'user',email:'ADMIN@EXAMPLE.COM'},{ADMIN_EMAILS:'admin@example.com'}),true);
});
test('OAuth state binds nonce, user, account, expiry and PKCE verifier',()=>{
  const issued=createOAuthState('account','user',{now:1000,signingSecret});
  const data=verifyOAuthState(issued.cookie,issued.state,'user',{now:2000,signingSecret});
  assert.equal(data.accountId,'account');assert.ok(data.verifier.length>=43);assert.ok(issued.challenge);
  for(const [cookie,state,user,now] of [[issued.cookie,'wrong','user',2000],[issued.cookie,issued.state,'other',2000],[issued.cookie,issued.state,'user',601_000],[issued.cookie+'x',issued.state,'user',2000]]) assert.throws(()=>verifyOAuthState(cookie,state,user,{now,signingSecret}));
});
