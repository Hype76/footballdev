alter table public.clubs
  add column if not exists onboarding_enabled boolean not null default true,
  add column if not exists onboarding_completed_steps jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_dismissed_at timestamptz,
  add column if not exists onboarding_reset_at timestamptz;

alter table public.users
  add column if not exists onboarding_reset_at timestamptz;

create index if not exists clubs_onboarding_enabled_idx on public.clubs(onboarding_enabled);
