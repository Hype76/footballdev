create table if not exists public.club_owner_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  invited_email text not null,
  accepted_email text,
  billing_mode text not null default 'paid',
  plan_key text not null default 'small_club',
  invite_token text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  invite_sent_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_owner_invites_billing_mode_check
    check (billing_mode in ('paid', 'unpaid')),
  constraint club_owner_invites_plan_key_check
    check (plan_key in ('individual', 'single_team', 'small_club', 'large_club')),
  constraint club_owner_invites_status_check
    check (status in ('pending', 'accepted', 'cancelled'))
);

create index if not exists club_owner_invites_club_id_idx
on public.club_owner_invites (club_id);

create index if not exists club_owner_invites_invited_email_idx
on public.club_owner_invites (lower(invited_email));

create index if not exists club_owner_invites_status_idx
on public.club_owner_invites (status);

create or replace function public.set_club_owner_invites_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_club_owner_invites_updated_at on public.club_owner_invites;
create trigger set_club_owner_invites_updated_at
before update on public.club_owner_invites
for each row
execute function public.set_club_owner_invites_updated_at();

grant select, insert, update, delete on public.club_owner_invites to authenticated;

alter table public.club_owner_invites enable row level security;

drop policy if exists club_owner_invites_select_scoped on public.club_owner_invites;
create policy club_owner_invites_select_scoped
on public.club_owner_invites
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or club_owner_invites.club_id = public.current_user_club_id()
);

drop policy if exists club_owner_invites_insert_platform_admin on public.club_owner_invites;
create policy club_owner_invites_insert_platform_admin
on public.club_owner_invites
for insert
to authenticated
with check (public.current_user_role() = 'super_admin');

drop policy if exists club_owner_invites_update_platform_admin on public.club_owner_invites;
create policy club_owner_invites_update_platform_admin
on public.club_owner_invites
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or club_owner_invites.club_id = public.current_user_club_id()
)
with check (
  public.current_user_role() = 'super_admin'
  or club_owner_invites.club_id = public.current_user_club_id()
);

drop policy if exists club_owner_invites_delete_platform_admin on public.club_owner_invites;
create policy club_owner_invites_delete_platform_admin
on public.club_owner_invites
for delete
to authenticated
using (public.current_user_role() = 'super_admin');
