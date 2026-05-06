alter table public.clubs
  add column if not exists plan_key text not null default 'small_club',
  add column if not exists plan_status text not null default 'active',
  add column if not exists is_plan_comped boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists plan_updated_at timestamptz not null default now();

alter table public.users
  add column if not exists onboarding_enabled boolean not null default true,
  add column if not exists onboarding_completed_steps jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_dismissed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clubs_plan_key_check'
      and conrelid = 'public.clubs'::regclass
  ) then
    alter table public.clubs
      add constraint clubs_plan_key_check
      check (plan_key in ('individual', 'single_team', 'small_club', 'large_club'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clubs_plan_status_check'
      and conrelid = 'public.clubs'::regclass
  ) then
    alter table public.clubs
      add constraint clubs_plan_status_check
      check (plan_status in ('active', 'trialing', 'past_due', 'cancelled'));
  end if;
end $$;

create index if not exists clubs_plan_key_idx on public.clubs(plan_key);
create index if not exists clubs_plan_status_idx on public.clubs(plan_status);
