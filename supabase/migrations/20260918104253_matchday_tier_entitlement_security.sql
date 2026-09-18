-- MATCHDAY-TIER-ENTITLEMENT-SECURITY
-- Adds canonical commercial tiers, an audited Matchday capability policy, and
-- database-side entitlement checks. Existing RLS role and resource checks
-- remain authoritative and are only made more restrictive by these gates.

create schema if not exists app_private;

create or replace function public.normalize_subscription_plan_key(raw_plan_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_plan_key is null or pg_catalog.btrim(raw_plan_key) = '' then 'matchday'
    when pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g'))
      in ('matchday', 'individual', 'individual_coach', 'individual_coach_free', 'individual_free', 'free') then 'matchday'
    when pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g'))
      in ('team', 'single', 'single_team') then 'team'
    when pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(raw_plan_key), '[^a-zA-Z0-9]+', '_', 'g'))
      in ('club', 'small_club', 'development', 'development_club', 'dev_club', 'large_club', 'contact', 'contact_sales', 'enterprise', 'negotiated', 'pilot') then 'club'
    else ''
  end
$$;

alter table if exists public.clubs drop constraint if exists clubs_plan_key_check;
alter table if exists public.clubs
  add constraint clubs_plan_key_check
  check (plan_key in ('matchday', 'team', 'club', 'individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'));

alter table if exists public.tester_access_codes drop constraint if exists tester_access_codes_plan_key_check;
alter table if exists public.tester_access_codes
  add constraint tester_access_codes_plan_key_check
  check (plan_key in ('matchday', 'team', 'club', 'individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'));

alter table if exists public.club_owner_invites drop constraint if exists club_owner_invites_plan_key_check;
alter table if exists public.club_owner_invites
  add constraint club_owner_invites_plan_key_check
  check (plan_key in ('matchday', 'team', 'club', 'individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot'));

create or replace function public.workspace_scope_for_plan_key(raw_plan_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case public.normalize_subscription_plan_key(raw_plan_key)
    when 'matchday' then 'team'
    when 'team' then 'team'
    when 'club' then 'club'
    else 'unknown'
  end
$$;

alter table if exists public.clubs
  add column if not exists subscription_team_capacity integer,
  add column if not exists matchday_free_forever boolean not null default false;

alter table if exists public.clubs
  drop constraint if exists clubs_subscription_team_capacity_check;
alter table if exists public.clubs
  add constraint clubs_subscription_team_capacity_check
  check (
    subscription_team_capacity is null
    or (
      subscription_team_capacity between 10 and 500
      and subscription_team_capacity % 10 = 0
    )
  );

alter table if exists public.stripe_checkout_records
  add column if not exists subscription_team_capacity integer;

alter table if exists public.stripe_checkout_records
  drop constraint if exists stripe_checkout_records_subscription_team_capacity_check;
alter table if exists public.stripe_checkout_records
  add constraint stripe_checkout_records_subscription_team_capacity_check
  check (
    subscription_team_capacity is null
    or (
      subscription_team_capacity between 10 and 500
      and subscription_team_capacity % 10 = 0
    )
  );

alter table if exists public.club_team_limit_overrides
  drop constraint if exists club_team_limit_overrides_package_capacity_check;
alter table if exists public.club_team_limit_overrides
  add constraint club_team_limit_overrides_package_capacity_check
  check (
    team_limit_override = 1
    or (
      team_limit_override between 10 and 500
      and team_limit_override % 10 = 0
    )
  ) not valid;

create or replace function app_private.matchday_default_flags()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'players', true,
    'teamCalendar', true,
    'fixtures', true,
    'matchDay', true,
    'parentPortal', true,
    'parentInvitations', true,
    'parentEmails', true,
    'pdfReports', true,
    'nativeAppEntitlement', true,
    'recurringEvents', true,
    'calendarExportFeed', true,
    'trainingEvents', false,
    'generalEvents', false,
    'teamPolls', false,
    'basicDevelopmentRecords', false,
    'goalsAndNotes', false,
    'basicPlayerFeedback', false,
    'limitedRecordHistory', false,
    'fullTeamRecords', false,
    'fullRecordHistory', false,
    'assessments', false,
    'standardAssessmentTemplates', false,
    'customDevelopmentFields', false,
    'monthlyEvaluations', false,
    'playerNotes', false,
    'attachments', false,
    'standardProgressViews', false,
    'parentCommunicationHistory', false,
    'teamStaffRoles', false,
    'basicLogoBranding', false,
    'basicActivityVisibility', false,
    'customColoursBranding', false,
    'trialPlayers', false,
    'resourceLibrary', false,
    'staffChat', false,
    'parentChat', false
  )
$$;

create or replace function app_private.validate_matchday_flags(flags_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  expected_flags constant jsonb := app_private.matchday_default_flags();
  item record;
begin
  if flags_value is null or pg_catalog.jsonb_typeof(flags_value) <> 'object' then
    raise exception using errcode = '22023', message = 'matchday_plan_config_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(flags_value) supplied(key)
    where not (expected_flags ? supplied.key)
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(expected_flags) expected(key)
    where not (flags_value ? expected.key)
  ) then
    raise exception using errcode = '22023', message = 'matchday_plan_config_invalid';
  end if;

  for item in select key, value from pg_catalog.jsonb_each(flags_value) loop
    if pg_catalog.jsonb_typeof(item.value) <> 'boolean' then
      raise exception using errcode = '22023', message = 'matchday_plan_config_invalid';
    end if;
  end loop;

  if (flags_value ->> 'fixtures')::boolean and not (flags_value ->> 'teamCalendar')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'matchDay')::boolean and not (flags_value ->> 'fixtures')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'recurringEvents')::boolean and not (flags_value ->> 'teamCalendar')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'calendarExportFeed')::boolean and not (flags_value ->> 'teamCalendar')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'trainingEvents')::boolean and not (flags_value ->> 'teamCalendar')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'generalEvents')::boolean and not (flags_value ->> 'teamCalendar')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'parentInvitations')::boolean and not (flags_value ->> 'parentPortal')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'parentEmails')::boolean and not (flags_value ->> 'parentPortal')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;
  if (flags_value ->> 'pdfReports')::boolean and not (flags_value ->> 'matchDay')::boolean then
    raise exception using errcode = '22023', message = 'matchday_plan_config_dependency_invalid';
  end if;

  return flags_value;
end;
$$;

create table if not exists public.matchday_plan_config (
  singleton boolean primary key default true check (singleton),
  revision integer not null default 1 check (revision > 0),
  flags jsonb not null default app_private.matchday_default_flags(),
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  constraint matchday_plan_config_flags_check
    check (app_private.validate_matchday_flags(flags) = flags)
);

create table if not exists public.matchday_plan_config_revisions (
  revision integer primary key check (revision > 0),
  flags jsonb not null,
  previous_flags jsonb,
  changed_by uuid references public.users (id) on delete set null,
  changed_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  constraint matchday_plan_config_revisions_flags_check
    check (app_private.validate_matchday_flags(flags) = flags)
);

insert into public.matchday_plan_config (singleton, revision, flags)
values (true, 1, app_private.matchday_default_flags())
on conflict (singleton) do nothing;

insert into public.matchday_plan_config_revisions (revision, flags, previous_flags, changed_by)
select config.revision, config.flags, null, config.updated_by
from public.matchday_plan_config config
where config.singleton
on conflict (revision) do nothing;

alter table public.matchday_plan_config enable row level security;
alter table public.matchday_plan_config force row level security;
alter table public.matchday_plan_config_revisions enable row level security;
alter table public.matchday_plan_config_revisions force row level security;

revoke all on table public.matchday_plan_config from public, anon, authenticated;
revoke all on table public.matchday_plan_config_revisions from public, anon, authenticated;
grant select, insert, update on table public.matchday_plan_config to service_role;
grant select, insert on table public.matchday_plan_config_revisions to service_role;

create or replace function public.get_matchday_plan_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'revision', config.revision,
    'flags', config.flags
  )
  from public.matchday_plan_config config
  where config.singleton
$$;

create or replace function public.save_matchday_plan_config(
  p_flags jsonb,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_config public.matchday_plan_config%rowtype;
  validated_flags jsonb;
begin
  if actor_id is null or not public.platform_access_is_admin_v1(actor_id) then
    raise exception using errcode = '42501', message = 'matchday_plan_config_not_permitted';
  end if;

  validated_flags := app_private.validate_matchday_flags(p_flags);

  select config.*
  into current_config
  from public.matchday_plan_config config
  where config.singleton
  for update;

  if current_config.singleton is null then
    raise exception using errcode = '55000', message = 'matchday_plan_config_unavailable';
  end if;

  if p_expected_revision is null or p_expected_revision <> current_config.revision then
    raise exception using
      errcode = '40001',
      message = 'matchday_plan_config_revision_conflict',
      detail = pg_catalog.jsonb_build_object('currentRevision', current_config.revision)::text;
  end if;

  if validated_flags = current_config.flags then
    return pg_catalog.jsonb_build_object(
      'revision', current_config.revision,
      'flags', current_config.flags
    );
  end if;

  update public.matchday_plan_config
  set revision = current_config.revision + 1,
      flags = validated_flags,
      updated_by = actor_id,
      updated_at = pg_catalog.timezone('utc', pg_catalog.now())
  where singleton;

  insert into public.matchday_plan_config_revisions (
    revision,
    flags,
    previous_flags,
    changed_by
  ) values (
    current_config.revision + 1,
    validated_flags,
    current_config.flags,
    actor_id
  );

  return pg_catalog.jsonb_build_object(
    'revision', current_config.revision + 1,
    'flags', validated_flags
  );
end;
$$;

create or replace function app_private.plan_capability_key(feature_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(feature_name, '')), '[^a-zA-Z0-9]+', '', 'g')) as key
  )
  select case key
    when 'players' then 'players'
    when 'secureauthentication' then 'secureAuthentication'
    when 'accountprotection' then 'accountProtection'
    when 'safeguardingcontrols' then 'safeguardingControls'
    when 'essentialrolepermissions' then 'essentialRolePermissions'
    when 'parentalconsentvisibilitycontrols' then 'parentalConsentVisibilityControls'
    when 'safetyauditability' then 'safetyAuditability'
    when 'datarightsaccess' then 'dataRightsAccess'
    when 'datarightsexport' then 'dataRightsExport'
    when 'datarightsdeletion' then 'dataRightsDeletion'
    when 'responsivewebpwa' then 'responsiveWebPwa'
    when 'footballplayerbranding' then 'footballPlayerBranding'
    when 'basicdevelopmentrecords' then 'basicDevelopmentRecords'
    when 'goalsandnotes' then 'goalsAndNotes'
    when 'basicplayerfeedback' then 'basicPlayerFeedback'
    when 'limitedrecordhistory' then 'limitedRecordHistory'
    when 'familyportalpreview' then 'familyPortalPreview'
    when 'parentportalpreview' then 'familyPortalPreview'
    when 'fullteamrecords' then 'fullTeamRecords'
    when 'fullrecordhistory' then 'fullRecordHistory'
    when 'assessments' then 'assessments'
    when 'monthlyevaluations' then 'monthlyEvaluations'
    when 'standardassessmenttemplates' then 'standardAssessmentTemplates'
    when 'customdevelopmentfields' then 'customDevelopmentFields'
    when 'customformfields' then 'customDevelopmentFields'
    when 'playernotes' then 'playerNotes'
    when 'attachments' then 'attachments'
    when 'standardprogressviews' then 'standardProgressViews'
    when 'parentportal' then 'parentPortal'
    when 'realparentportal' then 'parentPortal'
    when 'parentinvitations' then 'parentInvitations'
    when 'parentemails' then 'parentEmails'
    when 'parentemail' then 'parentEmails'
    when 'pdfreports' then 'pdfReports'
    when 'pdfexport' then 'pdfReports'
    when 'parentcommunicationhistory' then 'parentCommunicationHistory'
    when 'teamcalendar' then 'teamCalendar'
    when 'trainingevents' then 'trainingEvents'
    when 'fixtures' then 'fixtures'
    when 'generalevents' then 'generalEvents'
    when 'matchday' then 'matchDay'
    when 'teampolls' then 'teamPolls'
    when 'teamstaffroles' then 'teamStaffRoles'
    when 'basiclogobranding' then 'basicLogoBranding'
    when 'basicbranding' then 'basicLogoBranding'
    when 'basicactivityvisibility' then 'basicActivityVisibility'
    when 'recurringevents' then 'recurringEvents'
    when 'calendarexportfeed' then 'calendarExportFeed'
    when 'customcoloursbranding' then 'customColoursBranding'
    when 'custombranding' then 'customColoursBranding'
    when 'themes' then 'customColoursBranding'
    when 'trialplayers' then 'trialPlayers'
    when 'resourcelibrary' then 'resourceLibrary'
    when 'staffchat' then 'staffChat'
    when 'parentchat' then 'parentChat'
    when 'clubadministration' then 'clubAdministration'
    when 'clubstaffroles' then 'clubStaffRoles'
    when 'sharedplayeroversight' then 'sharedPlayerOversight'
    when 'bulkinvitesimports' then 'bulkInvitesImports'
    when 'clubwidecalendar' then 'clubWideCalendar'
    when 'clubwideevents' then 'clubWideEvents'
    when 'sharedreporttemplates' then 'sharedReportTemplates'
    when 'fulloperationalauditlog' then 'fullOperationalAuditLog'
    when 'auditlogs' then 'fullOperationalAuditLog'
    when 'basicclubanalytics' then 'basicClubAnalytics'
    when 'advanceddevelopmentanalytics' then 'advancedDevelopmentAnalytics'
    when 'playerpathways' then 'playerPathways'
    when 'coachhandovers' then 'coachHandovers'
    when 'scheduledreviewcycles' then 'scheduledReviewCycles'
    when 'approvalworkflows' then 'approvalWorkflows'
    when 'approvalworkflow' then 'approvalWorkflows'
    when 'customassessmenttemplates' then 'customAssessmentTemplates'
    when 'customreporttemplates' then 'customReportTemplates'
    when 'clubwideoperationalexports' then 'clubWideOperationalExports'
    when 'operationalexports' then 'clubWideOperationalExports'
    when 'scheduledparentreports' then 'scheduledParentReports'
    when 'prioritysupport' then 'prioritySupport'
    when 'negotiatedlimits' then 'negotiatedLimits'
    when 'bespokebranding' then 'bespokeBranding'
    when 'assistedsetup' then 'assistedSetup'
    when 'datamigration' then 'dataMigration'
    when 'customonboarding' then 'customOnboarding'
    when 'rolloutplanning' then 'rolloutPlanning'
    when 'integrations' then 'integrations'
    when 'externalcalendarintegrations' then 'externalCalendarIntegrations'
    when 'dedicatedsupportcontact' then 'dedicatedSupportContact'
    when 'agreedserviceterms' then 'agreedServiceTerms'
    when 'platformadminaccess' then 'platformAdminAccess'
    when 'nativeappentitlement' then 'nativeAppEntitlement'
    else ''
  end
  from normalized
$$;

create or replace function public.can_use_plan_feature(target_club_id uuid, feature_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw_plan_key text;
  canonical_plan_key text;
  target_is_plan_comped boolean;
  capability_key text := app_private.plan_capability_key(feature_name);
  flags_value jsonb;
  baseline_keys constant text[] := array[
    'secureAuthentication', 'accountProtection', 'safeguardingControls',
    'essentialRolePermissions', 'parentalConsentVisibilityControls', 'safetyAuditability',
    'dataRightsAccess', 'dataRightsExport', 'dataRightsDeletion', 'responsiveWebPwa',
    'footballPlayerBranding'
  ];
  club_only_keys constant text[] := array[
    'clubAdministration', 'clubStaffRoles', 'sharedPlayerOversight', 'bulkInvitesImports',
    'clubWideCalendar', 'clubWideEvents', 'sharedReportTemplates', 'fullOperationalAuditLog',
    'basicClubAnalytics', 'advancedDevelopmentAnalytics', 'playerPathways', 'coachHandovers',
    'scheduledReviewCycles', 'approvalWorkflows', 'customAssessmentTemplates',
    'customReportTemplates', 'clubWideOperationalExports', 'scheduledParentReports',
    'customColoursBranding',
    'prioritySupport', 'negotiatedLimits', 'bespokeBranding', 'assistedSetup',
    'dataMigration', 'customOnboarding', 'rolloutPlanning', 'integrations',
    'externalCalendarIntegrations', 'dedicatedSupportContact', 'agreedServiceTerms'
  ];
begin
  if capability_key = '' or target_club_id is null then
    return false;
  end if;

  if capability_key = any(baseline_keys) then
    return true;
  end if;

  select club.plan_key, public.normalize_subscription_plan_key(club.plan_key), coalesce(club.is_plan_comped, false)
  into raw_plan_key, canonical_plan_key, target_is_plan_comped
  from public.clubs club
  where club.id = target_club_id;

  if canonical_plan_key = '' or canonical_plan_key is null then
    return false;
  end if;

  if canonical_plan_key <> 'matchday'
    and pg_catalog.lower(coalesce(raw_plan_key, '')) <> 'pilot'
    and not target_is_plan_comped
    and not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if capability_key = 'platformAdminAccess' then
    return false;
  end if;

  if canonical_plan_key = 'club' then
    return true;
  end if;

  if canonical_plan_key = 'team' then
    return not (capability_key = any(club_only_keys));
  end if;

  if capability_key = 'familyPortalPreview' then
    return false;
  end if;

  select config.flags into flags_value
  from public.matchday_plan_config config
  where config.singleton;

  flags_value := coalesce(flags_value, app_private.matchday_default_flags());
  return coalesce((flags_value ->> capability_key)::boolean, false);
end;
$$;

create or replace function public.can_insert_player_for_plan(
  target_club_id uuid,
  target_section text,
  target_player_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_club_id is not null
    and pg_catalog.btrim(coalesce(target_player_name, '')) <> ''
    and public.can_use_plan_feature(target_club_id, 'players')
$$;

create or replace function public.can_insert_evaluation_for_plan(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_use_plan_feature(target_club_id, 'assessments')
$$;

create or replace function public.can_insert_staff_invite_for_plan(target_club_id uuid, target_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_club_id is not null
    and pg_catalog.btrim(coalesce(target_email, '')) <> ''
    and (
      public.can_use_plan_feature(target_club_id, 'teamStaffRoles')
      or public.can_use_plan_feature(target_club_id, 'clubStaffRoles')
    )
$$;

create or replace function public.can_insert_team_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_plan_key text;
  canonical_plan_key text;
  target_is_plan_comped boolean;
  purchased_capacity integer;
  legacy_override integer;
  current_team_count integer;
  team_limit integer;
begin
  select
    club.plan_key,
    public.normalize_subscription_plan_key(club.plan_key),
    coalesce(club.is_plan_comped, false),
    club.subscription_team_capacity,
    limits.team_limit_override
  into raw_plan_key, canonical_plan_key, target_is_plan_comped, purchased_capacity, legacy_override
  from public.clubs club
  left join public.club_team_limit_overrides limits on limits.club_id = club.id
  where club.id = target_club_id;

  if canonical_plan_key = '' or canonical_plan_key is null then
    return false;
  end if;

  if canonical_plan_key <> 'matchday'
    and pg_catalog.lower(coalesce(raw_plan_key, '')) <> 'pilot'
    and not target_is_plan_comped
    and not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  if canonical_plan_key in ('matchday', 'team') then
    team_limit := 1;
  else
    team_limit := case
      when purchased_capacity between 10 and 500 and purchased_capacity % 10 = 0 then purchased_capacity
      when legacy_override between 10 and 500 and legacy_override % 10 = 0 then legacy_override
      else 10
    end;
  end if;

  select pg_catalog.count(*) into current_team_count
  from public.teams team
  where team.club_id = target_club_id;

  return current_team_count < team_limit;
end;
$$;

create or replace function app_private.billing_access_state(target_club_id uuid, at_time timestamptz default pg_catalog.now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when club.id is null then 'payment_required'
    when club.archived_at is not null then 'archived'
    when public.normalize_subscription_plan_key(club.plan_key) = '' then 'payment_required'
    when public.normalize_subscription_plan_key(club.plan_key) = 'matchday' then 'full'
    when pg_catalog.lower(coalesce(club.plan_key, '')) = 'pilot' then 'full'
    when pg_catalog.lower(coalesce(club.plan_status, '')) in ('active', 'trialing') then 'full'
    when coalesce(club.is_plan_comped, false) or club.billing_arrangement = 'complimentary' then 'full'
    when club.billing_arrangement is null then 'full'
    when club.billing_arrangement = 'immediate' then 'payment_required'
    when club.billing_arrangement = 'deferred' and club.billing_start_at > at_time then
      case when club.billing_start_at <= at_time + interval '7 days' then 'payment_due_soon' else 'full' end
    else 'payment_required'
  end
  from public.clubs club
  where club.id = target_club_id
$$;

create or replace function app_private.enforce_plan_capability_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_value jsonb := case when tg_op = 'DELETE' then pg_catalog.to_jsonb(old) else pg_catalog.to_jsonb(new) end;
  target_club_id uuid;
  required_capability text := tg_argv[0];
begin
  if auth.uid() is null or public.platform_access_is_admin_v1(auth.uid()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  target_club_id := nullif(row_value ->> 'club_id', '')::uuid;
  if target_club_id is null or not public.can_use_plan_feature(target_club_id, required_capability) then
    raise exception using errcode = '42501', message = 'plan_capability_not_available';
  end if;

  if tg_table_name = 'players'
    and tg_op <> 'DELETE'
    and pg_catalog.lower(pg_catalog.btrim(coalesce(row_value ->> 'section', ''))) = 'trial'
    and not public.can_use_plan_feature(target_club_id, 'trialPlayers') then
    raise exception using errcode = '42501', message = 'plan_capability_not_available';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $policy_gates$
declare
  gate record;
begin
  for gate in
    select * from (values
      ('evaluations', 'assessments'),
      ('assessment_sessions', 'assessments'),
      ('form_fields', 'customDevelopmentFields'),
      ('match_days', 'fixtures'),
      ('match_day_events', 'matchDay'),
      ('match_day_scorer_interest', 'matchDay'),
      ('match_day_scorer_assignments', 'matchDay'),
      ('parent_player_links', 'parentPortal'),
      ('calendar_trial_event_invitations', 'trialPlayers'),
      ('resource_library_items', 'resourceLibrary'),
      ('resource_library_links', 'resourceLibrary'),
      ('resource_library_external_links', 'resourceLibrary'),
      ('resource_library_parent_notifications', 'resourceLibrary'),
      ('staff_chat_conversations', 'staffChat'),
      ('staff_chat_members', 'staffChat'),
      ('staff_chat_messages', 'staffChat'),
      ('staff_chat_mobile_notification_intents', 'staffChat'),
      ('parent_chat_rooms', 'parentChat'),
      ('parent_chat_memberships', 'parentChat'),
      ('parent_chat_messages', 'parentChat'),
      ('parent_chat_mobile_notification_intents', 'parentChat')
    ) as gates(table_name, capability_key)
  loop
    if pg_catalog.to_regclass('public.' || gate.table_name) is not null then
      execute pg_catalog.format(
        'drop policy if exists plan_capability_select_restrictive on public.%I',
        gate.table_name
      );
      execute pg_catalog.format(
        'create policy plan_capability_select_restrictive on public.%I as restrictive for select to authenticated using (public.platform_access_is_admin_v1((select auth.uid())) or public.can_use_plan_feature(club_id, %L))',
        gate.table_name,
        gate.capability_key
      );
    end if;
  end loop;

  if pg_catalog.to_regclass('public.players') is not null then
    execute 'drop policy if exists plan_capability_select_restrictive on public.players';
    execute $players_policy$
      create policy plan_capability_select_restrictive
      on public.players
      as restrictive
      for select
      to authenticated
      using (
        public.platform_access_is_admin_v1((select auth.uid()))
        or (
          public.can_use_plan_feature(club_id, 'players')
          and (
            pg_catalog.lower(pg_catalog.btrim(coalesce(section, ''))) <> 'trial'
            or public.can_use_plan_feature(club_id, 'trialPlayers')
          )
        )
      )
    $players_policy$;
  end if;

  if pg_catalog.to_regclass('public.calendar_events') is not null then
    execute 'drop policy if exists plan_capability_select_restrictive on public.calendar_events';
    execute $calendar_policy$
      create policy plan_capability_select_restrictive
      on public.calendar_events
      as restrictive
      for select
      to authenticated
      using (
        public.platform_access_is_admin_v1((select auth.uid()))
        or (
          public.can_use_plan_feature(club_id, 'teamCalendar')
          and public.can_use_plan_feature(
            club_id,
            case
              when team_id is null then 'clubWideEvents'
              when event_type = 'training' then 'trainingEvents'
              when event_type = 'match' then 'fixtures'
              else 'generalEvents'
            end
          )
          and (
            coalesce(recurrence_frequency, 'none') = 'none'
            or public.can_use_plan_feature(club_id, 'recurringEvents')
          )
        )
      )
    $calendar_policy$;
  end if;
end
$policy_gates$;

do $helper_gates$
begin
  if pg_catalog.to_regprocedure('public.current_user_can_access_parent_player(uuid)') is not null then
    execute $function$
      create or replace function public.current_user_can_access_parent_player(target_player_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select (select auth.uid()) is not null
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player
              on player.id = link.player_id
             and player.club_id = link.club_id
            where link.auth_user_id = (select auth.uid())
              and link.status = 'active'
              and link.player_id = target_player_id
              and coalesce(player.status, 'active') <> 'archived'
              and public.can_use_plan_feature(link.club_id, 'parentPortal')
              and not exists (
                select 1
                from public.users actor
                where actor.id = (select auth.uid())
                  and actor.status = 'suspended'
                  and (actor.role = 'parent_portal' or actor.club_id = link.club_id)
              )
          )
      $body$
    $function$;

    execute $function$
      create or replace function public.current_user_can_access_parent_team(target_team_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select (select auth.uid()) is not null
          and target_team_id is not null
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player
              on player.id = link.player_id
             and player.club_id = link.club_id
            where link.auth_user_id = (select auth.uid())
              and link.status = 'active'
              and coalesce(player.status, 'active') <> 'archived'
              and player.team_id = target_team_id
              and coalesce(link.team_id, player.team_id) = target_team_id
              and public.can_use_plan_feature(link.club_id, 'parentPortal')
              and not exists (
                select 1
                from public.users actor
                where actor.id = (select auth.uid())
                  and actor.status = 'suspended'
                  and (actor.role = 'parent_portal' or actor.club_id = link.club_id)
              )
          )
      $body$
    $function$;

    execute $function$
      create or replace function public.current_user_can_access_parent_link(
        target_parent_link_id uuid,
        target_player_id uuid
      )
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select (select auth.uid()) is not null
          and exists (
            select 1
            from public.parent_player_links parent_link
            join public.players player
              on player.id = parent_link.player_id
             and player.club_id = parent_link.club_id
            where parent_link.id = target_parent_link_id
              and parent_link.auth_user_id = (select auth.uid())
              and parent_link.status = 'active'
              and parent_link.player_id = target_player_id
              and coalesce(player.status, 'active') <> 'archived'
              and public.can_use_plan_feature(parent_link.club_id, 'parentPortal')
              and not exists (
                select 1
                from public.users actor
                where actor.id = (select auth.uid())
                  and actor.status = 'suspended'
                  and (actor.role = 'parent_portal' or actor.club_id = parent_link.club_id)
              )
          )
      $body$
    $function$;

    execute $function$
      create or replace function public.current_user_can_access_parent_club(target_club_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select (select auth.uid()) is not null
          and target_club_id is not null
          and exists (
            select 1
            from public.parent_player_links link
            join public.players player
              on player.id = link.player_id
             and player.club_id = link.club_id
            where link.auth_user_id = (select auth.uid())
              and link.status = 'active'
              and link.club_id = target_club_id
              and coalesce(player.status, 'active') <> 'archived'
              and public.can_use_plan_feature(link.club_id, 'parentPortal')
              and not exists (
                select 1
                from public.users actor
                where actor.id = (select auth.uid())
                  and actor.status = 'suspended'
                  and (actor.role = 'parent_portal' or actor.club_id = link.club_id)
              )
          )
      $body$
    $function$;
  end if;

  if pg_catalog.to_regprocedure('public.current_user_can_use_staff_chat(uuid)') is not null then
    execute $function$
      create or replace function public.current_user_can_use_staff_chat(target_club_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select auth.uid() is not null
          and public.current_user_club_id() = target_club_id
          and public.current_user_role() not in ('parent_portal', 'super_admin')
          and public.current_user_role_rank() >= 20
          and public.can_use_plan_feature(target_club_id, 'staffChat')
      $body$
    $function$;
  end if;

  if pg_catalog.to_regprocedure('public.current_user_can_view_resource_library(uuid,uuid)') is not null then
    execute $function$
      create or replace function public.current_user_can_view_resource_library(target_club_id uuid, target_team_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select auth.uid() is not null
          and public.current_user_club_id() = target_club_id
          and public.current_user_role() not in ('parent_portal', 'super_admin')
          and public.current_user_role_rank() >= 20
          and target_team_id is not null
          and public.can_use_plan_feature(target_club_id, 'resourceLibrary')
          and public.resource_library_user_can_access_team(auth.uid(), target_team_id, target_club_id)
      $body$
    $function$;

    execute $function$
      create or replace function public.current_user_can_manage_resource_library(target_club_id uuid, target_team_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select auth.uid() is not null
          and public.current_user_club_id() = target_club_id
          and public.current_user_role() not in ('parent_portal', 'super_admin')
          and public.current_user_role_rank() >= 50
          and target_team_id is not null
          and public.can_use_plan_feature(target_club_id, 'resourceLibrary')
          and public.resource_library_user_can_access_team(auth.uid(), target_team_id, target_club_id)
      $body$
    $function$;
  end if;

  if pg_catalog.to_regprocedure('public.parent_chat_user_can_access_room(uuid,uuid)') is not null then
    execute $function$
      create or replace function public.parent_chat_user_can_access_room(
        target_room_id uuid,
        target_user_id uuid default auth.uid()
      )
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select target_user_id is not null
          and exists (
            select 1
            from public.parent_chat_rooms room
            where room.id = target_room_id
              and room.status in ('active', 'closed')
              and public.can_use_plan_feature(room.club_id, 'parentChat')
              and (
                public.parent_chat_parent_can_access_room(room.id, target_user_id)
                or public.parent_chat_staff_can_access_team(
                  target_user_id,
                  room.club_id,
                  room.team_id
                )
              )
          )
      $body$
    $function$;
  end if;
end
$helper_gates$;

create or replace function app_private.enforce_trusted_club_commercial_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or public.platform_access_is_admin_v1(auth.uid()) then
      return new;
    end if;

    raise exception using errcode = '42501', message = 'club_commercial_fields_not_permitted';
  end if;

  if old.plan_key is not distinct from new.plan_key
    and old.plan_status is not distinct from new.plan_status
    and old.is_plan_comped is not distinct from new.is_plan_comped
    and old.billing_arrangement is not distinct from new.billing_arrangement
    and old.billing_start_at is not distinct from new.billing_start_at
    and old.subscription_team_capacity is not distinct from new.subscription_team_capacity
    and old.matchday_free_forever is not distinct from new.matchday_free_forever then
    return new;
  end if;

  if auth.uid() is null or public.platform_access_is_admin_v1(auth.uid()) then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'club_commercial_fields_not_permitted';
end;
$$;

create or replace function app_private.enforce_calendar_event_plan_capabilities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_value public.calendar_events%rowtype := case when tg_op = 'DELETE' then old else new end;
  event_capability text;
begin
  if auth.uid() is null or public.platform_access_is_admin_v1(auth.uid()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if row_value.team_id is null then
    event_capability := 'clubWideEvents';
  elsif row_value.event_type = 'training' then
    event_capability := 'trainingEvents';
  elsif row_value.event_type = 'match' then
    event_capability := 'fixtures';
  else
    event_capability := 'generalEvents';
  end if;

  if not public.can_use_plan_feature(row_value.club_id, 'teamCalendar')
    or not public.can_use_plan_feature(row_value.club_id, event_capability)
    or (
      coalesce(row_value.recurrence_frequency, 'none') <> 'none'
      and not public.can_use_plan_feature(row_value.club_id, 'recurringEvents')
    ) then
    raise exception using errcode = '42501', message = 'plan_capability_not_available';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  gate record;
begin
  for gate in
    select * from (values
      ('players', 'players'),
      ('evaluations', 'assessments'),
      ('assessment_sessions', 'assessments'),
      ('form_fields', 'customDevelopmentFields'),
      ('match_days', 'fixtures'),
      ('match_day_events', 'matchDay'),
      ('match_day_scorer_interest', 'matchDay'),
      ('match_day_scorer_assignments', 'matchDay'),
      ('calendar_trial_event_invitations', 'trialPlayers'),
      ('resource_library_items', 'resourceLibrary'),
      ('resource_library_links', 'resourceLibrary'),
      ('resource_library_external_links', 'resourceLibrary'),
      ('resource_library_parent_notifications', 'resourceLibrary'),
      ('staff_chat_conversations', 'staffChat'),
      ('staff_chat_members', 'staffChat'),
      ('staff_chat_messages', 'staffChat'),
      ('staff_chat_mobile_notification_intents', 'staffChat'),
      ('parent_chat_rooms', 'parentChat'),
      ('parent_chat_memberships', 'parentChat'),
      ('parent_chat_messages', 'parentChat'),
      ('parent_chat_mobile_notification_intents', 'parentChat')
    ) as gates(table_name, capability_key)
  loop
    if pg_catalog.to_regclass('public.' || gate.table_name) is not null then
      execute pg_catalog.format('drop trigger if exists enforce_plan_capability_mutation on public.%I', gate.table_name);
      execute pg_catalog.format(
        'create trigger enforce_plan_capability_mutation before insert or update or delete on public.%I for each row execute function app_private.enforce_plan_capability_mutation(%L)',
        gate.table_name,
        gate.capability_key
      );
    end if;
  end loop;
end
$$;

drop trigger if exists enforce_trusted_club_commercial_fields on public.clubs;
create trigger enforce_trusted_club_commercial_fields
before insert or update on public.clubs
for each row execute function app_private.enforce_trusted_club_commercial_fields();

drop trigger if exists enforce_calendar_event_plan_capabilities on public.calendar_events;
create trigger enforce_calendar_event_plan_capabilities
before insert or update or delete on public.calendar_events
for each row execute function app_private.enforce_calendar_event_plan_capabilities();

revoke all on function public.normalize_subscription_plan_key(text) from public, anon;
revoke all on function public.workspace_scope_for_plan_key(text) from public, anon;
revoke all on function app_private.matchday_default_flags() from public, anon, authenticated;
revoke all on function app_private.validate_matchday_flags(jsonb) from public, anon, authenticated;
revoke all on function app_private.plan_capability_key(text) from public, anon, authenticated;
revoke all on function app_private.enforce_plan_capability_mutation() from public, anon, authenticated;
revoke all on function app_private.enforce_calendar_event_plan_capabilities() from public, anon, authenticated;
revoke all on function app_private.enforce_trusted_club_commercial_fields() from public, anon, authenticated;
revoke all on function app_private.billing_access_state(uuid, timestamptz) from public, anon, authenticated;

revoke all on function public.get_matchday_plan_config() from public;
grant execute on function public.get_matchday_plan_config() to anon, authenticated, service_role;

revoke all on function public.save_matchday_plan_config(jsonb, integer) from public, anon, service_role;
grant execute on function public.save_matchday_plan_config(jsonb, integer) to authenticated;

revoke all on function public.can_use_plan_feature(uuid, text) from public, anon;
revoke all on function public.can_insert_player_for_plan(uuid, text, text) from public, anon;
revoke all on function public.can_insert_evaluation_for_plan(uuid) from public, anon;
revoke all on function public.can_insert_staff_invite_for_plan(uuid, text) from public, anon;
revoke all on function public.can_insert_team_for_plan(uuid) from public, anon;

grant execute on function public.normalize_subscription_plan_key(text) to authenticated, service_role;
grant execute on function public.workspace_scope_for_plan_key(text) to authenticated, service_role;
grant execute on function public.can_use_plan_feature(uuid, text) to authenticated, service_role;
grant execute on function public.can_insert_player_for_plan(uuid, text, text) to authenticated, service_role;
grant execute on function public.can_insert_evaluation_for_plan(uuid) to authenticated, service_role;
grant execute on function public.can_insert_staff_invite_for_plan(uuid, text) to authenticated, service_role;
grant execute on function public.can_insert_team_for_plan(uuid) to authenticated, service_role;

comment on table public.matchday_plan_config is
  'Singleton non-secret Matchday capability policy. Direct access is denied; use the read and admin save RPCs.';
comment on table public.matchday_plan_config_revisions is
  'Immutable audit history for Matchday capability policy revisions.';
comment on column public.clubs.subscription_team_capacity is
  'Trusted paid Club team capacity in packages of ten. Matchday and Team remain limited to one team.';
comment on column public.clubs.matchday_free_forever is
  'Trusted signup cohort marker. Matchday accounts marked true retain free Matchday eligibility through later plan changes.';
