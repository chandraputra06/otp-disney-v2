-- Additive migration: preserves existing account IDs, numbers, tokens and history.
-- Works for an existing project and for an empty Supabase project.
begin;

create table if not exists public.otp_accounts (
  id uuid primary key default gen_random_uuid(),
  service text not null default 'disney',
  phone_number text not null unique,
  label text, is_active boolean not null default true,
  last_checked_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.gmail_tokens (
  id uuid primary key default gen_random_uuid(),
  otp_account_id uuid not null unique references public.otp_accounts(id) on delete cascade,
  access_token text, refresh_token text, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.otp_accounts add column if not exists disney_email text;
alter table public.otp_accounts add column if not exists check_lock_id uuid;
alter table public.otp_accounts add column if not exists check_lock_until timestamptz;
alter table public.otp_accounts add column if not exists last_status text;
alter table public.otp_accounts add column if not exists last_message_id text;
alter table public.otp_accounts add column if not exists last_received_at timestamptz;
alter table public.gmail_tokens add column if not exists gmail_email text;
alter table public.gmail_tokens add column if not exists connection_version uuid not null default gen_random_uuid();

alter table public.otp_accounts enable row level security;
alter table public.gmail_tokens enable row level security;
-- Preserve existing otp_messages. The new app does not store codes or email bodies.
do $$ begin
  if to_regclass('public.otp_messages') is not null then
    alter table public.otp_messages enable row level security;
    revoke all on public.otp_messages from anon, authenticated;
  end if;
end $$;
revoke all on public.otp_accounts, public.gmail_tokens from anon, authenticated;
grant all on public.otp_accounts, public.gmail_tokens to service_role;

create or replace function public.claim_otp_check(p_account_id uuid, p_lock_id uuid)
returns table(acquired boolean, retry_after integer)
language plpgsql security definer set search_path = '' as $$
declare a public.otp_accounts%rowtype; t timestamptz := clock_timestamp();
begin
  select * into a from public.otp_accounts where id = p_account_id for update;
  if not found or not a.is_active or a.service <> 'disney' then
    return query select false, 5; return;
  end if;
  if a.check_lock_until > t or a.last_checked_at > t - interval '5 seconds' then
    return query select false, greatest(1, ceil(extract(epoch from
      greatest(coalesce(a.check_lock_until,t), coalesce(a.last_checked_at + interval '5 seconds',t)) - t))::integer);
    return;
  end if;
  update public.otp_accounts set check_lock_id = p_lock_id,
    check_lock_until = t + interval '25 seconds', last_checked_at = t where id = p_account_id;
  return query select true, 5;
end $$;

create or replace function public.finish_otp_check(
  p_account_id uuid, p_lock_id uuid, p_connection_version uuid, p_recipient text,
  p_status text, p_message_id text, p_received_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a public.otp_accounts%rowtype; unchanged boolean;
begin
  select * into a from public.otp_accounts where id = p_account_id for update;
  if not found or a.check_lock_id is distinct from p_lock_id then return false; end if;
  unchanged := a.is_active and a.service = 'disney' and a.disney_email = p_recipient
    and a.check_lock_until > clock_timestamp()
    and exists (select 1 from public.gmail_tokens g where g.otp_account_id = p_account_id
      and g.connection_version = p_connection_version);
  update public.otp_accounts set check_lock_id = null, check_lock_until = null,
    last_status = case when unchanged then p_status else 'connection_changed' end,
    last_message_id = case when unchanged then p_message_id else null end,
    last_received_at = case when unchanged then p_received_at else null end
    where id = p_account_id;
  return unchanged;
end $$;

revoke all on function public.claim_otp_check(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_otp_check(uuid,uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_otp_check(uuid,uuid) to service_role;
grant execute on function public.finish_otp_check(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;
commit;
