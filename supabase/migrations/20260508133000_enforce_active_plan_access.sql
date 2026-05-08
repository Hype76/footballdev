create or replace function public.is_club_plan_access_active(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_status text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_status, 'active'), coalesce(is_plan_comped, false)
  into target_plan_status, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_status is null then
    return false;
  end if;

  return target_is_plan_comped or target_plan_status in ('active', 'trialing');
end;
$$;

create or replace function public.can_insert_team_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_team_count integer := 0;
  team_limit integer;
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if target_is_plan_comped or target_plan_key = 'large_club' then
    return true;
  end if;

  team_limit := case target_plan_key
    when 'individual' then 1
    when 'single_team' then 1
    when 'small_club' then 10
    else 10
  end;

  select count(*)
  into existing_team_count
  from public.teams
  where club_id = target_club_id;

  return existing_team_count < team_limit;
end;
$$;

create or replace function public.can_use_plan_feature(target_club_id uuid, feature_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if target_is_plan_comped or target_plan_key = 'large_club' then
    return true;
  end if;

  return case feature_name
    when 'pdf_export' then target_plan_key in ('single_team', 'small_club')
    when 'parent_email' then target_plan_key in ('single_team', 'small_club')
    when 'custom_form_fields' then target_plan_key in ('single_team', 'small_club')
    when 'basic_branding' then target_plan_key in ('single_team', 'small_club')
    when 'custom_branding' then target_plan_key = 'small_club'
    when 'themes' then target_plan_key = 'small_club'
    when 'audit_logs' then target_plan_key = 'small_club'
    when 'approval_workflow' then target_plan_key = 'small_club'
    else false
  end;
end;
$$;

create or replace function public.can_insert_player_for_plan(
  target_club_id uuid,
  target_section text,
  target_player_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_player_count integer := 0;
  player_limit integer;
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if exists (
    select 1
    from public.players
    where club_id = target_club_id
      and section = target_section
      and lower(player_name) = lower(target_player_name)
      and coalesce(status, 'active') <> 'archived'
  ) then
    return true;
  end if;

  if target_is_plan_comped or target_plan_key in ('small_club', 'large_club') then
    return true;
  end if;

  player_limit := case target_plan_key
    when 'individual' then 5
    when 'single_team' then 20
    else 20
  end;

  select count(*)
  into existing_player_count
  from public.players
  where club_id = target_club_id
    and coalesce(status, 'active') <> 'archived';

  return existing_player_count < player_limit;
end;
$$;

create or replace function public.can_insert_evaluation_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_evaluation_count integer := 0;
  target_plan_key text;
  target_is_plan_comped boolean;
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if target_is_plan_comped or target_plan_key <> 'individual' then
    return true;
  end if;

  select count(*)
  into existing_evaluation_count
  from public.evaluations
  where club_id = target_club_id
    and created_at >= date_trunc('month', now());

  return existing_evaluation_count < 10;
end;
$$;

create or replace function public.can_insert_staff_invite_for_plan(target_club_id uuid, target_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  access_email_count integer := 0;
  staff_limit integer;
  target_plan_key text;
  target_is_plan_comped boolean;
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  select coalesce(plan_key, 'small_club'), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or normalized_email = '' or not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if exists (
    select 1
    from public.users
    where club_id = target_club_id
      and lower(email) = normalized_email
  ) or exists (
    select 1
    from public.club_user_invites
    where club_id = target_club_id
      and lower(email) = normalized_email
      and accepted_at is null
  ) then
    return true;
  end if;

  if target_is_plan_comped or target_plan_key in ('small_club', 'large_club') then
    return true;
  end if;

  staff_limit := case target_plan_key
    when 'individual' then 1
    when 'single_team' then 3
    else 3
  end;

  select count(distinct email)
  into access_email_count
  from (
    select lower(email) as email
    from public.users
    where club_id = target_club_id
    union
    select lower(email) as email
    from public.club_user_invites
    where club_id = target_club_id
      and accepted_at is null
  ) access_emails;

  return access_email_count < staff_limit;
end;
$$;

revoke all on function public.is_club_plan_access_active(uuid) from public;
grant execute on function public.is_club_plan_access_active(uuid) to authenticated;
