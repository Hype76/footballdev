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

  if old.logo_url is distinct from new.logo_url then
    if public.current_user_role() <> 'admin' then
      raise exception 'Only club admins can change the club logo.';
    end if;

    if not public.can_use_plan_feature(new.id, 'basic_branding') then
      raise exception 'Logo branding is not included in this plan.';
    end if;
  end if;

  if old.require_approval is distinct from new.require_approval
    and not public.can_use_plan_feature(new.id, 'approval_workflow') then
    raise exception 'Approval workflow is not included in this plan.';
  end if;

  return new;
end;
$$;
