-- Light, Dark and System are personal display preferences for every active user.
-- Keep the existing paid branding check for accent changes and all write authority.
create or replace function public.enforce_user_plan_update_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_user_role() = 'super_admin' then
    return new;
  end if;

  if old.theme_accent is distinct from new.theme_accent
    and not public.can_use_plan_feature(new.club_id, 'themes') then
    raise exception 'Theme preferences are not included in this plan.';
  end if;

  return new;
end;
$$;
