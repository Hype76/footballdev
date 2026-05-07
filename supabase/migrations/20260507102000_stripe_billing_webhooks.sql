create table if not exists public.stripe_checkout_records (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id text unique,
  customer_email text not null,
  club_id uuid references public.clubs(id) on delete set null,
  club_name text,
  plan_key text not null,
  plan_status text not null default 'trialing',
  billing_cycle text,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_end timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_checkout_records_email_idx
  on public.stripe_checkout_records(lower(customer_email));

create index if not exists stripe_checkout_records_club_id_idx
  on public.stripe_checkout_records(club_id);

create index if not exists stripe_checkout_records_subscription_idx
  on public.stripe_checkout_records(stripe_subscription_id);

alter table public.stripe_checkout_records enable row level security;

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
