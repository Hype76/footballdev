alter table public.clubs
add column if not exists theme_accent text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clubs_theme_accent_check'
      and conrelid = 'public.clubs'::regclass
  ) then
    alter table public.clubs
    add constraint clubs_theme_accent_check
    check (theme_accent in ('yellow', 'blue', 'green', 'red', 'purple'));
  end if;
end
$$;

update public.clubs as club
set theme_accent = coalesce(
  (
    select team.theme_accent
    from public.teams as team
    where team.club_id = club.id
      and team.theme_accent in ('yellow', 'blue', 'green', 'red', 'purple')
    group by team.theme_accent
    order by count(*) desc, team.theme_accent asc
    limit 1
  ),
  'green'
)
where club.theme_accent is null;

alter table public.clubs
alter column theme_accent set default 'green';

alter table public.clubs
alter column theme_accent set not null;

create or replace function public.enforce_club_plan_update_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_user_role() = 'super_admin' then
    return new;
  end if;

  if old.logo_url is distinct from new.logo_url
    and not public.can_use_plan_feature(new.id, 'basicLogoBranding') then
    raise exception 'Logo branding is not included in this plan.';
  end if;

  if old.require_approval is distinct from new.require_approval
    and not public.can_use_plan_feature(new.id, 'approvalWorkflows') then
    raise exception 'Approval workflow is not included in this plan.';
  end if;

  if old.theme_accent is distinct from new.theme_accent then
    if public.current_user_role() <> 'admin'
      or public.current_user_club_id() is distinct from new.id then
      raise exception 'Only the Club Admin can change the club accent colour.';
    end if;

    if not public.can_use_plan_feature(new.id, 'customColoursBranding') then
      raise exception 'Custom colours and club branding are not included in this plan.';
    end if;
  end if;

  return new;
end;
$$;
