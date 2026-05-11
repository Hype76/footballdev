alter table public.email_logs
  drop constraint if exists email_logs_dedupe_key_key;

drop index if exists public.email_logs_dedupe_key_key;

create index if not exists email_logs_dedupe_recent_idx
on public.email_logs (dedupe_key, created_at desc)
where dedupe_key is not null;
