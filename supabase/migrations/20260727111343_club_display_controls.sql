alter table public.clubs
add column if not exists theme_button_style text;

alter table public.clubs
drop constraint if exists clubs_theme_accent_check;

alter table public.clubs
add constraint clubs_theme_accent_check
check (
  theme_accent in ('yellow', 'blue', 'green', 'red', 'purple')
  or theme_accent ~ '^#[0-9a-f]{6}$'
);

update public.clubs
set theme_button_style = 'solid'
where theme_button_style is null;

alter table public.clubs
alter column theme_button_style set default 'solid';

alter table public.clubs
alter column theme_button_style set not null;

alter table public.clubs
drop constraint if exists clubs_theme_button_style_check;

alter table public.clubs
add constraint clubs_theme_button_style_check
check (theme_button_style in ('solid', 'gradient'));

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

  if old.theme_button_style is distinct from new.theme_button_style then
    if public.current_user_role() <> 'admin'
      or public.current_user_club_id() is distinct from new.id then
      raise exception 'Only the Club Admin can change the club button style.';
    end if;

    if not public.can_use_plan_feature(new.id, 'customColoursBranding') then
      raise exception 'Custom colours and club branding are not included in this plan.';
    end if;
  end if;

  return new;
end;
$$;
