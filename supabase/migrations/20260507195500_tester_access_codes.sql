create table if not exists public.tester_access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text,
  plan_key text not null,
  assigned_email text,
  max_uses integer not null default 1,
  redeemed_count integer not null default 0,
  expires_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tester_access_codes_plan_key_check
    check (plan_key in ('individual', 'single_team', 'small_club', 'large_club')),
  constraint tester_access_codes_max_uses_check
    check (max_uses > 0),
  constraint tester_access_codes_redeemed_count_check
    check (redeemed_count >= 0)
);

alter table public.clubs
  add column if not exists tester_access_code_id uuid references public.tester_access_codes(id) on delete set null,
  add column if not exists tester_access_code text,
  add column if not exists tester_access_email text,
  add column if not exists tester_access_redeemed_at timestamptz,
  add column if not exists tester_access_expires_at timestamptz;

create index if not exists tester_access_codes_code_idx
  on public.tester_access_codes (lower(code));

create index if not exists tester_access_codes_active_expiry_idx
  on public.tester_access_codes (is_active, expires_at);

create index if not exists clubs_tester_access_expires_idx
  on public.clubs (tester_access_expires_at);

alter table public.tester_access_codes enable row level security;

drop policy if exists tester_access_codes_select_super_admin on public.tester_access_codes;
create policy tester_access_codes_select_super_admin
on public.tester_access_codes
for select
to authenticated
using (public.current_user_role() = 'super_admin');

drop policy if exists tester_access_codes_insert_super_admin on public.tester_access_codes;
create policy tester_access_codes_insert_super_admin
on public.tester_access_codes
for insert
to authenticated
with check (public.current_user_role() = 'super_admin');

drop policy if exists tester_access_codes_update_super_admin on public.tester_access_codes;
create policy tester_access_codes_update_super_admin
on public.tester_access_codes
for update
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');
