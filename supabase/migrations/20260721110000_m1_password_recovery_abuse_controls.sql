create table if not exists public.password_recovery_rate_limit_attempts (
  id bigint generated always as identity primary key,
  email_digest text not null check (email_digest ~ '^[0-9a-f]{64}$'),
  ip_digest text not null check (ip_digest ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default clock_timestamp()
);

alter table public.password_recovery_rate_limit_attempts enable row level security;

revoke all on table public.password_recovery_rate_limit_attempts from anon, authenticated, public;
revoke all on sequence public.password_recovery_rate_limit_attempts_id_seq from anon, authenticated, public;

create index if not exists password_recovery_rate_limit_attempts_email_idx
  on public.password_recovery_rate_limit_attempts (email_digest, attempted_at desc);

create index if not exists password_recovery_rate_limit_attempts_ip_idx
  on public.password_recovery_rate_limit_attempts (ip_digest, attempted_at desc);

create index if not exists password_recovery_rate_limit_attempts_expiry_idx
  on public.password_recovery_rate_limit_attempts (attempted_at);

create or replace function public.consume_password_recovery_rate_limit(
  p_email_digest text,
  p_ip_digest text,
  p_window_seconds integer default 900,
  p_email_limit integer default 3,
  p_ip_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_allowed boolean;
  v_email_count integer;
  v_ip_count integer;
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
begin
  if p_email_digest !~ '^[0-9a-f]{64}$'
    or p_ip_digest !~ '^[0-9a-f]{64}$'
    or p_window_seconds not between 60 and 86400
    or p_email_limit not between 1 and 100
    or p_ip_limit not between 1 and 1000 then
    raise exception 'INVALID_PASSWORD_RECOVERY_RATE_LIMIT_INPUT' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_email_digest, 91011));
  perform pg_advisory_xact_lock(hashtextextended(p_ip_digest, 91012));

  v_window_start := v_now - make_interval(secs => p_window_seconds);

  select count(*)::integer
  into v_email_count
  from public.password_recovery_rate_limit_attempts
  where email_digest = p_email_digest
    and attempted_at >= v_window_start;

  select count(*)::integer
  into v_ip_count
  from public.password_recovery_rate_limit_attempts
  where ip_digest = p_ip_digest
    and attempted_at >= v_window_start;

  v_allowed := v_email_count < p_email_limit and v_ip_count < p_ip_limit;

  insert into public.password_recovery_rate_limit_attempts (email_digest, ip_digest, attempted_at)
  values (p_email_digest, p_ip_digest, v_now);

  delete from public.password_recovery_rate_limit_attempts
  where attempted_at < v_now - interval '24 hours';

  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', case when v_allowed then 0 else p_window_seconds end
  );
end;
$$;

revoke all on function public.consume_password_recovery_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_password_recovery_rate_limit(text, text, integer, integer, integer) to service_role;

comment on table public.password_recovery_rate_limit_attempts is
  'Short-lived HMAC digests used only to bound password recovery abuse. Raw email addresses and client addresses are not stored.';
