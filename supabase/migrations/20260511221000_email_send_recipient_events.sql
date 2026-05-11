create table if not exists public.email_send_events (
  id uuid primary key default gen_random_uuid(),
  email_log_id uuid references public.email_logs (id) on delete cascade,
  dedupe_key text not null,
  created_at timestamp with time zone not null default timezone('utc', now())
);

create index if not exists email_send_events_dedupe_created_idx
on public.email_send_events (dedupe_key, created_at desc);
