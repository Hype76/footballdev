-- FP-PAYWALL-FOUNDATION-04
-- Documentation-only until this migration is explicitly applied.
-- Rollback notes:
-- 1. Recreate the previous plan_key check constraints without development_club.
-- 2. Restore previous function bodies from the migration history if needed.
-- 3. Do not coerce stored plan values during rollback without a separate approved data plan.

create or replace function public.normalize_subscription_plan_key(raw_plan_key text)
returns text
language sql
immutable
as $$
  select case
    when raw_plan_key is null or btrim(raw_plan_key) = '' then 'individual'
    when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('individual', 'individual_coach', 'individual_coach_free', 'individual_free', 'free') then 'individual'
    when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('single', 'single_team', 'team') then 'single_team'
    when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) = 'small_club' then 'small_club'
    when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('development', 'development_club', 'dev_club') then 'development_club'
    when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) in ('large_club', 'contact', 'contact_sales', 'enterprise', 'negotiated') then 'large_club'
    else ''
  end
$$;

alter table if exists public.clubs
  drop constraint if exists clubs_plan_key_check;

alter table if exists public.clubs
  add constraint clubs_plan_key_check
  check (plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club'));

alter table if exists public.tester_access_codes
  drop constraint if exists tester_access_codes_plan_key_check;

alter table if exists public.tester_access_codes
  add constraint tester_access_codes_plan_key_check
  check (plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club'));

alter table if exists public.club_owner_invites
  drop constraint if exists club_owner_invites_plan_key_check;

alter table if exists public.club_owner_invites
  add constraint club_owner_invites_plan_key_check
  check (plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club'));

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
  select public.normalize_subscription_plan_key(plan_key), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null then
    return false;
  end if;

  if target_plan_key = '' then
    return false;
  end if;

  if target_is_plan_comped then
    return true;
  end if;

  return case feature_name
    when 'pdf_export' then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when 'parent_email' then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when 'custom_form_fields' then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when 'basic_branding' then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when 'custom_branding' then target_plan_key in ('small_club', 'development_club', 'large_club')
    when 'themes' then target_plan_key in ('small_club', 'development_club', 'large_club')
    when 'audit_logs' then target_plan_key in ('small_club', 'development_club', 'large_club')
    when 'approval_workflow' then target_plan_key in ('small_club', 'development_club', 'large_club')
    else false
  end;
end;
$$;

create or replace function public.can_insert_team_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_is_plan_comped boolean;
  target_plan_is_active boolean;
  current_team_count integer;
  team_limit integer;
begin
  select public.normalize_subscription_plan_key(plan_key), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' then
    return false;
  end if;

  target_plan_is_active := public.is_club_plan_access_active(target_club_id);

  if target_is_plan_comped then
    return true;
  end if;

  if not target_plan_is_active then
    return false;
  end if;

  select count(*)
  into current_team_count
  from public.teams
  where club_id = target_club_id;

  team_limit := case target_plan_key
    when 'individual' then 1
    when 'single_team' then 1
    when 'small_club' then 5
    when 'development_club' then 10
    when 'large_club' then 10
    else 0
  end;

  return current_team_count < team_limit;
end;
$$;

create or replace function public.can_insert_player_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_is_plan_comped boolean;
  target_plan_is_active boolean;
  current_player_count integer;
  player_limit integer;
begin
  select public.normalize_subscription_plan_key(plan_key), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' then
    return false;
  end if;

  target_plan_is_active := public.is_club_plan_access_active(target_club_id);

  if target_is_plan_comped or target_plan_key in ('small_club', 'development_club', 'large_club') then
    return true;
  end if;

  if not target_plan_is_active then
    return false;
  end if;

  select count(*)
  into current_player_count
  from public.players
  where club_id = target_club_id
    and coalesce(status, '') <> 'archived';

  player_limit := case target_plan_key
    when 'individual' then 5
    when 'single_team' then 30
    else 0
  end;

  return current_player_count < player_limit;
end;
$$;

create or replace function public.can_insert_staff_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_is_plan_comped boolean;
  target_plan_is_active boolean;
  current_staff_count integer;
  staff_limit integer;
begin
  select public.normalize_subscription_plan_key(plan_key), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' then
    return false;
  end if;

  target_plan_is_active := public.is_club_plan_access_active(target_club_id);

  if target_is_plan_comped or target_plan_key in ('small_club', 'development_club', 'large_club') then
    return true;
  end if;

  if not target_plan_is_active then
    return false;
  end if;

  select count(*)
  into current_staff_count
  from public.users
  where club_id = target_club_id;

  staff_limit := case target_plan_key
    when 'individual' then 1
    when 'single_team' then 5
    else 0
  end;

  return current_staff_count < staff_limit;
end;
$$;

revoke all on function public.normalize_subscription_plan_key(text) from public;
grant execute on function public.normalize_subscription_plan_key(text) to authenticated;

revoke all on function public.can_use_plan_feature(uuid, text) from public;
grant execute on function public.can_use_plan_feature(uuid, text) to authenticated;

revoke all on function public.can_insert_team_for_plan(uuid) from public;
grant execute on function public.can_insert_team_for_plan(uuid) to authenticated;

revoke all on function public.can_insert_player_for_plan(uuid) from public;
grant execute on function public.can_insert_player_for_plan(uuid) to authenticated;

revoke all on function public.can_insert_staff_for_plan(uuid) from public;
grant execute on function public.can_insert_staff_for_plan(uuid) to authenticated;
