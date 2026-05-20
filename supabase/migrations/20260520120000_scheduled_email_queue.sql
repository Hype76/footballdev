create table if not exists public.scheduled_email_queue (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  created_by uuid,
  created_by_email text not null default '',
  to_email text not null,
  subject text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'failed')),
  scheduled_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_email_queue_due_idx
on public.scheduled_email_queue (scheduled_at, status);

create index if not exists scheduled_email_queue_club_status_idx
on public.scheduled_email_queue (club_id, status, scheduled_at);

create or replace function public.set_scheduled_email_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_scheduled_email_queue_updated_at on public.scheduled_email_queue;

create trigger set_scheduled_email_queue_updated_at
before update on public.scheduled_email_queue
for each row
execute function public.set_scheduled_email_queue_updated_at();

alter table public.scheduled_email_queue enable row level security;
