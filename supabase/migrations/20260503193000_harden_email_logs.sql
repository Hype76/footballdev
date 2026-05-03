alter table public.email_logs
  add column if not exists idempotency_key text,
  add column if not exists is_processing boolean not null default false,
  add column if not exists next_retry_at timestamptz;

update public.email_logs
set idempotency_key = coalesce(idempotency_key, dedupe_key, id::text)
where idempotency_key is null;

create unique index if not exists email_logs_idempotency_key_uidx
  on public.email_logs (idempotency_key)
  where idempotency_key is not null;

create index if not exists email_logs_retry_queue_idx
  on public.email_logs (status, is_processing, next_retry_at, attempts);
