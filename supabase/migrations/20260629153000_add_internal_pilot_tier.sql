-- FP-PILOT-TIER-01
-- Adds the internal Pilot plan key to trusted database plan checks.
-- Do not apply to production without explicit release approval.

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
    when lower(regexp_replace(btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g')) = 'pilot' then 'pilot'
    else ''
  end
$$;

alter table if exists public.clubs
  drop constraint if exists clubs_plan_key_check;

alter table if exists public.clubs
  add constraint clubs_plan_key_check
  check (plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'));

alter table if exists public.tester_access_codes
  drop constraint if exists tester_access_codes_plan_key_check;

alter table if exists public.tester_access_codes
  add constraint tester_access_codes_plan_key_check
  check (plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'));

alter table if exists public.club_owner_invites
  drop constraint if exists club_owner_invites_plan_key_check;

alter table if exists public.club_owner_invites
  add constraint club_owner_invites_plan_key_check
  check (plan_key in ('individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'));

create or replace function public.can_use_plan_feature(target_club_id uuid, feature_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_entitlement_plan_key text;
  target_is_plan_comped boolean;
  normalized_feature_key text;
begin
  select public.normalize_subscription_plan_key(plan_key), coalesce(is_plan_comped, false)
  into target_plan_key, target_is_plan_comped
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' then
    return false;
  end if;

  target_entitlement_plan_key := case
    when target_plan_key = 'pilot' then 'large_club'
    else target_plan_key
  end;

  normalized_feature_key := lower(regexp_replace(btrim(coalesce(feature_name, '')), '[^a-zA-Z0-9]+', '_', 'g'));

  if normalized_feature_key = '' then
    return false;
  end if;

  if normalized_feature_key in (
    'secureauthentication',
    'secure_authentication',
    'accountprotection',
    'account_protection',
    'safeguardingcontrols',
    'safeguarding_controls',
    'essentialrolepermissions',
    'essential_role_permissions',
    'parentalconsentvisibilitycontrols',
    'parental_consent_visibility_controls',
    'safetyauditability',
    'safety_auditability',
    'datarightsaccess',
    'data_rights_access',
    'datarightsexport',
    'data_rights_export',
    'datarightsdeletion',
    'data_rights_deletion',
    'basicdevelopmentrecords',
    'basic_development_records',
    'goalsandnotes',
    'goals_and_notes',
    'basicplayerfeedback',
    'basic_player_feedback',
    'limitedrecordhistory',
    'limited_record_history',
    'responsivewebpwa',
    'responsive_web_pwa',
    'footballplayerbranding',
    'football_player_branding',
    'familyportalpreview',
    'family_portal_preview',
    'parentportalpreview',
    'parent_portal_preview'
  ) then
    return true;
  end if;

  if target_plan_key <> 'pilot'
    and not target_is_plan_comped
    and not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  return case
    when normalized_feature_key in ('fullteamrecords', 'full_team_records') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('fullrecordhistory', 'full_record_history') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('assessments', 'monthlyevaluations', 'monthly_evaluations') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('standardassessmenttemplates', 'standard_assessment_templates') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('customdevelopmentfields', 'custom_development_fields', 'customformfields', 'custom_form_fields') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('playernotes', 'player_notes', 'attachments', 'standardprogressviews', 'standard_progress_views') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentportal', 'parent_portal', 'realparentportal', 'real_parent_portal') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentinvitations', 'parent_invitations') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentemails', 'parent_emails', 'parentemail', 'parent_email') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('pdfreports', 'pdf_reports', 'pdfexport', 'pdf_export') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentcommunicationhistory', 'parent_communication_history') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('teamcalendar', 'team_calendar', 'trainingevents', 'training_events', 'fixtures', 'generalevents', 'general_events') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('matchday', 'match_day', 'teampolls', 'team_polls') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('teamstaffroles', 'team_staff_roles') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('basiclogobranding', 'basic_logo_branding', 'basicbranding', 'basic_branding') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('basicactivityvisibility', 'basic_activity_visibility') then target_entitlement_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('clubadministration', 'club_administration') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('clubstaffroles', 'club_staff_roles') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('sharedplayeroversight', 'shared_player_oversight', 'bulkinvitesimports', 'bulk_invites_imports') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('clubwidecalendar', 'club_wide_calendar', 'clubwideevents', 'club_wide_events') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('recurringevents', 'recurring_events', 'calendarexportfeed', 'calendar_export_feed') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('sharedreporttemplates', 'shared_report_templates') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('customcoloursbranding', 'custom_colours_branding', 'custombranding', 'custom_branding', 'themes') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('fulloperationalauditlog', 'full_operational_audit_log', 'auditlogs', 'audit_logs') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('basicclubanalytics', 'basic_club_analytics') then target_entitlement_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('advanceddevelopmentanalytics', 'advanced_development_analytics') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('playerpathways', 'player_pathways', 'coachhandovers', 'coach_handovers') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('scheduledreviewcycles', 'scheduled_review_cycles') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('approvalworkflows', 'approval_workflows', 'approvalworkflow', 'approval_workflow') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('customassessmenttemplates', 'custom_assessment_templates') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('customreporttemplates', 'custom_report_templates') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('clubwideoperationalexports', 'club_wide_operational_exports', 'operationalexports', 'operational_exports') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('scheduledparentreports', 'scheduled_parent_reports', 'prioritysupport', 'priority_support') then target_entitlement_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('negotiatedlimits', 'negotiated_limits', 'bespokebranding', 'bespoke_branding') then target_entitlement_plan_key = 'large_club'
    when normalized_feature_key in ('assistedsetup', 'assisted_setup', 'datamigration', 'data_migration', 'customonboarding', 'custom_onboarding', 'rolloutplanning', 'rollout_planning') then target_entitlement_plan_key = 'large_club'
    when normalized_feature_key in ('dedicatedsupportcontact', 'dedicated_support_contact', 'agreedserviceterms', 'agreed_service_terms') then target_entitlement_plan_key = 'large_club'
    when normalized_feature_key in ('integrations', 'externalcalendarintegrations', 'external_calendar_integrations') then false
    when normalized_feature_key in ('nativeappentitlement', 'native_app_entitlement') then false
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
  target_entitlement_plan_key text;
  normalized_section text := btrim(coalesce(target_section, ''));
  normalized_player_name text := lower(btrim(coalesce(target_player_name, '')));
begin
  select public.normalize_subscription_plan_key(plan_key)
  into target_plan_key
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' or normalized_player_name = '' then
    return false;
  end if;

  target_entitlement_plan_key := case
    when target_plan_key = 'pilot' then 'large_club'
    else target_plan_key
  end;

  if exists (
    select 1
    from public.players
    where club_id = target_club_id
      and section = normalized_section
      and lower(player_name) = normalized_player_name
      and coalesce(status, 'active') <> 'archived'
  ) then
    return true;
  end if;

  if not public.can_use_plan_feature(target_club_id, 'basicDevelopmentRecords') then
    return false;
  end if;

  if target_entitlement_plan_key in ('small_club', 'development_club', 'large_club') then
    return true;
  end if;

  player_limit := case target_entitlement_plan_key
    when 'individual' then 5
    when 'single_team' then 30
    else 0
  end;

  select count(*)
  into existing_player_count
  from public.players
  where club_id = target_club_id
    and coalesce(status, 'active') <> 'archived';

  return existing_player_count < player_limit;
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
  target_entitlement_plan_key text;
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  select public.normalize_subscription_plan_key(plan_key)
  into target_plan_key
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' or normalized_email = '' then
    return false;
  end if;

  target_entitlement_plan_key := case
    when target_plan_key = 'pilot' then 'large_club'
    else target_plan_key
  end;

  if not public.can_use_plan_feature(target_club_id, 'teamStaffRoles')
    and not public.can_use_plan_feature(target_club_id, 'clubStaffRoles') then
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

  if target_entitlement_plan_key in ('small_club', 'development_club', 'large_club') then
    return true;
  end if;

  staff_limit := case target_entitlement_plan_key
    when 'individual' then 1
    when 'single_team' then 5
    else 0
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

create or replace function public.can_insert_team_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
  target_entitlement_plan_key text;
  target_is_plan_comped boolean;
  target_plan_is_active boolean;
  target_team_limit_override integer;
  current_team_count integer;
  team_limit integer;
begin
  select public.normalize_subscription_plan_key(c.plan_key), coalesce(c.is_plan_comped, false), o.team_limit_override
  into target_plan_key, target_is_plan_comped, target_team_limit_override
  from public.clubs c
  left join public.club_team_limit_overrides o on o.club_id = c.id
  where c.id = target_club_id;

  if target_plan_key is null or target_plan_key = '' then
    return false;
  end if;

  target_entitlement_plan_key := case
    when target_plan_key = 'pilot' then 'large_club'
    else target_plan_key
  end;

  target_plan_is_active := public.is_club_plan_access_active(target_club_id);

  if target_is_plan_comped and target_plan_key <> 'pilot' then
    return true;
  end if;

  if target_plan_key <> 'pilot' and not target_plan_is_active then
    return false;
  end if;

  select count(*)
  into current_team_count
  from public.teams
  where club_id = target_club_id;

  team_limit := coalesce(
    target_team_limit_override,
    case target_entitlement_plan_key
      when 'individual' then 1
      when 'single_team' then 1
      when 'small_club' then 5
      when 'development_club' then 10
      when 'large_club' then 10
      else 0
    end
  );

  return current_team_count < team_limit;
end;
$$;

revoke all on function public.normalize_subscription_plan_key(text) from public;
revoke all on function public.can_use_plan_feature(uuid, text) from public;
revoke all on function public.can_insert_player_for_plan(uuid, text, text) from public;
revoke all on function public.can_insert_staff_invite_for_plan(uuid, text) from public;
revoke all on function public.can_insert_team_for_plan(uuid) from public;

grant execute on function public.normalize_subscription_plan_key(text) to authenticated;
grant execute on function public.can_use_plan_feature(uuid, text) to authenticated;
grant execute on function public.can_insert_player_for_plan(uuid, text, text) to authenticated;
grant execute on function public.can_insert_staff_invite_for_plan(uuid, text) to authenticated;
grant execute on function public.can_insert_team_for_plan(uuid) to authenticated;
