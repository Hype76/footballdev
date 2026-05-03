create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique,
  to_email text not null,
  subject text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_logs_status_idx on public.email_logs (status);
create index if not exists email_logs_created_at_idx on public.email_logs (created_at);
create index if not exists email_logs_status_created_at_idx on public.email_logs (status, created_at);

create or replace function public.set_email_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_email_logs_updated_at on public.email_logs;

create trigger set_email_logs_updated_at
before update on public.email_logs
for each row
execute function public.set_email_logs_updated_at();

alter table public.email_logs enable row level security;
