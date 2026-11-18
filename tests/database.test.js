import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const account='11111111-1111-4111-8111-111111111111';
const version='22222222-2222-4222-8222-222222222222';
const lock='33333333-3333-4333-8333-333333333333';
const otherLock='44444444-4444-4444-8444-444444444444';

test('PostgreSQL migration preserves mappings and enforces leases and privileges',async(t)=>{
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    // Existing schema and duplicate legacy history must survive the migration.
    await db.exec("create table public.otp_accounts (id uuid primary key default gen_random_uuid(),service text not null default 'disney',phone_number text unique not null,label text,is_active boolean default true,last_checked_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());create table public.gmail_tokens(id uuid primary key default gen_random_uuid(),otp_account_id uuid unique references public.otp_accounts(id),access_token text,refresh_token text,expires_at timestamptz);create table public.otp_messages(id uuid primary key default gen_random_uuid(),otp_account_id uuid references public.otp_accounts(id),message_id text);");
    await db.query('insert into otp_accounts(id,phone_number) values($1,$2)',[account,'081234567890']);
    await db.query('insert into gmail_tokens(otp_account_id,refresh_token) values($1,$2)',[account,'existing-test-token']);
    await db.query("insert into otp_messages(otp_account_id,message_id) values($1,'same'),($1,'same')",[account]);
    const migration=await readFile(new URL('../supabase/migrations/001_reliable_otp.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(migration);
    await t.test('migration is repeatable and leaves old accounts, tokens and history intact',async()=>{
      assert.equal((await db.query('select phone_number from otp_accounts')).rows[0].phone_number,'081234567890');
      assert.equal((await db.query('select refresh_token from gmail_tokens')).rows[0].refresh_token,'existing-test-token');
      assert.equal((await db.query('select count(*)::int n from otp_messages')).rows[0].n,2);
    });
    await db.query("update otp_accounts set disney_email='one@example.com';update gmail_tokens set connection_version=$1",[version]).catch(async()=>{
      await db.query("update otp_accounts set disney_email='one@example.com'");
      await db.query('update gmail_tokens set connection_version=$1',[version]);
    });
    await t.test('only one claimant gets the per-account lease',async()=>{
      assert.equal((await db.query('select * from claim_otp_check($1,$2)',[account,lock])).rows[0].acquired,true);
      const second=(await db.query('select * from claim_otp_check($1,$2)',[account,otherLock])).rows[0];
      assert.equal(second.acquired,false);assert.ok(second.retry_after>0);
    });
    await t.test('a stale request cannot release another request lease',async()=>{
      const result=(await db.query("select finish_otp_check($1,$2,$3,'one@example.com','success','test',now()) ok",[account,otherLock,version])).rows[0].ok;
      assert.equal(result,false);
    });
    await t.test('valid completion releases lease, records metadata, keeps cooldown',async()=>{
      const result=(await db.query("select finish_otp_check($1,$2,$3,'one@example.com','success','test',now()) ok",[account,lock,version])).rows[0].ok;
      assert.equal(result,true);
      const row=(await db.query('select check_lock_id,last_status from otp_accounts')).rows[0];
      assert.equal(row.check_lock_id,null);assert.equal(row.last_status,'success');
      assert.equal((await db.query('select * from claim_otp_check($1,$2)',[account,otherLock])).rows[0].acquired,false);
    });
    await t.test('changing recipient during fetch invalidates completion',async()=>{
      await db.exec("update otp_accounts set last_checked_at=now()-interval '1 minute'");
      await db.query('select * from claim_otp_check($1,$2)',[account,lock]);
      await db.exec("update otp_accounts set disney_email='two@example.com'");
      assert.equal((await db.query("select finish_otp_check($1,$2,$3,'one@example.com','success','test',now()) ok",[account,lock,version])).rows[0].ok,false);
    });
    await t.test('anon/authenticated roles cannot read tokens or call the claim function',async()=>{
      await db.exec('set role authenticated');
      await assert.rejects(db.query('select refresh_token from public.gmail_tokens'),/permission denied/);
      await assert.rejects(db.query('select * from public.claim_otp_check($1,$2)',[account,lock]),/permission denied/);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
