-- FP-PAYWALL-SERVER-07
-- Documentation-only until this migration is explicitly applied.
-- Rollback notes:
-- 1. Restore public.can_use_plan_feature and plan limit functions from the previous migration history.
-- 2. Recreate the previous calendar, parent link, staff invite, audit, form field, and storage policies if needed.
-- 3. Do not update stored plan values or production data as part of rollback.

create or replace function public.can_use_plan_feature(target_club_id uuid, feature_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_key text;
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

  if not target_is_plan_comped and not public.is_club_plan_access_active(target_club_id) then
    return false;
  end if;

  return case
    when normalized_feature_key in ('fullteamrecords', 'full_team_records') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('fullrecordhistory', 'full_record_history') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('assessments', 'monthlyevaluations', 'monthly_evaluations') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('standardassessmenttemplates', 'standard_assessment_templates') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('customdevelopmentfields', 'custom_development_fields', 'customformfields', 'custom_form_fields') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('playernotes', 'player_notes', 'attachments', 'standardprogressviews', 'standard_progress_views') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentportal', 'parent_portal', 'realparentportal', 'real_parent_portal') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentinvitations', 'parent_invitations') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentemails', 'parent_emails', 'parentemail', 'parent_email') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('pdfreports', 'pdf_reports', 'pdfexport', 'pdf_export') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('parentcommunicationhistory', 'parent_communication_history') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('teamcalendar', 'team_calendar', 'trainingevents', 'training_events', 'fixtures', 'generalevents', 'general_events') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('matchday', 'match_day', 'teampolls', 'team_polls') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('teamstaffroles', 'team_staff_roles') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('basiclogobranding', 'basic_logo_branding', 'basicbranding', 'basic_branding') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('basicactivityvisibility', 'basic_activity_visibility') then target_plan_key in ('single_team', 'small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('clubadministration', 'club_administration') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('clubstaffroles', 'club_staff_roles') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('sharedplayeroversight', 'shared_player_oversight', 'bulkinvitesimports', 'bulk_invites_imports') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('clubwidecalendar', 'club_wide_calendar', 'clubwideevents', 'club_wide_events') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('recurringevents', 'recurring_events', 'calendarexportfeed', 'calendar_export_feed') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('sharedreporttemplates', 'shared_report_templates') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('customcoloursbranding', 'custom_colours_branding', 'custombranding', 'custom_branding', 'themes') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('fulloperationalauditlog', 'full_operational_audit_log', 'auditlogs', 'audit_logs') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('basicclubanalytics', 'basic_club_analytics') then target_plan_key in ('small_club', 'development_club', 'large_club')
    when normalized_feature_key in ('advanceddevelopmentanalytics', 'advanced_development_analytics') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('playerpathways', 'player_pathways', 'coachhandovers', 'coach_handovers') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('scheduledreviewcycles', 'scheduled_review_cycles') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('approvalworkflows', 'approval_workflows', 'approvalworkflow', 'approval_workflow') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('customassessmenttemplates', 'custom_assessment_templates') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('customreporttemplates', 'custom_report_templates') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('clubwideoperationalexports', 'club_wide_operational_exports', 'operationalexports', 'operational_exports') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('scheduledparentreports', 'scheduled_parent_reports', 'prioritysupport', 'priority_support') then target_plan_key in ('development_club', 'large_club')
    when normalized_feature_key in ('negotiatedlimits', 'negotiated_limits', 'bespokebranding', 'bespoke_branding') then target_plan_key = 'large_club'
    when normalized_feature_key in ('assistedsetup', 'assisted_setup', 'datamigration', 'data_migration', 'customonboarding', 'custom_onboarding', 'rolloutplanning', 'rollout_planning') then target_plan_key = 'large_club'
    when normalized_feature_key in ('dedicatedsupportcontact', 'dedicated_support_contact', 'agreedserviceterms', 'agreed_service_terms') then target_plan_key = 'large_club'
    when normalized_feature_key in ('integrations', 'externalcalendarintegrations', 'external_calendar_integrations') then false
    when normalized_feature_key in ('nativeappentitlement', 'native_app_entitlement') then false
    else false
  end;
end;
$$;

create or replace function public.can_insert_evaluation_for_plan(target_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.can_use_plan_feature(target_club_id, 'assessments');
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

  if target_plan_key in ('small_club', 'development_club', 'large_club') or public.can_use_plan_feature(target_club_id, 'assessments') then
    if target_plan_key in ('small_club', 'development_club', 'large_club') then
      return true;
    end if;
  end if;

  player_limit := case target_plan_key
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
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  select public.normalize_subscription_plan_key(plan_key)
  into target_plan_key
  from public.clubs
  where id = target_club_id;

  if target_plan_key is null or target_plan_key = '' or normalized_email = '' then
    return false;
  end if;

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

  if target_plan_key in ('small_club', 'development_club', 'large_club') then
    return true;
  end if;

  staff_limit := case target_plan_key
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

drop policy if exists calendar_events_insert_scoped on public.calendar_events;
create policy calendar_events_insert_scoped
on public.calendar_events
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and created_by = auth.uid()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
      and public.can_use_plan_feature(calendar_events.club_id, 'clubWideEvents')
    )
    or (
      team_id is not null
      and public.can_use_plan_feature(calendar_events.club_id, 'teamCalendar')
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
  and (
    coalesce(recurrence_frequency, 'none') = 'none'
    or public.can_use_plan_feature(calendar_events.club_id, 'recurringEvents')
  )
  and (
    coalesce(parent_visible, false) = false
    or public.can_use_plan_feature(calendar_events.club_id, 'parentPortal')
  )
);

drop policy if exists calendar_events_update_scoped on public.calendar_events;
create policy calendar_events_update_scoped
on public.calendar_events
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
      and public.can_use_plan_feature(calendar_events.club_id, 'clubWideEvents')
    )
    or (
      team_id is not null
      and public.can_use_plan_feature(calendar_events.club_id, 'teamCalendar')
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
)
with check (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
      and public.can_use_plan_feature(calendar_events.club_id, 'clubWideEvents')
    )
    or (
      team_id is not null
      and public.can_use_plan_feature(calendar_events.club_id, 'teamCalendar')
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
  and (
    coalesce(recurrence_frequency, 'none') = 'none'
    or public.can_use_plan_feature(calendar_events.club_id, 'recurringEvents')
  )
  and (
    coalesce(parent_visible, false) = false
    or public.can_use_plan_feature(calendar_events.club_id, 'parentPortal')
  )
);

drop policy if exists calendar_events_delete_scoped on public.calendar_events;
create policy calendar_events_delete_scoped
on public.calendar_events
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    (
      team_id is null
      and public.current_user_role() = 'admin'
      and public.can_use_plan_feature(calendar_events.club_id, 'clubWideEvents')
    )
    or (
      team_id is not null
      and public.can_use_plan_feature(calendar_events.club_id, 'teamCalendar')
      and (
        public.current_user_role() = 'admin'
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = calendar_events.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
);

drop policy if exists parent_player_links_insert_scoped on public.parent_player_links;
create policy parent_player_links_insert_scoped
on public.parent_player_links
for insert
to authenticated
with check (
  auth.uid() = auth_user_id
  or (
    link_type = 'family'
    and public.current_user_can_access_parent_link(parent_link_id, player_id)
  )
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
    and public.can_use_plan_feature(parent_player_links.club_id, 'parentInvitations')
    and exists (
      select 1
      from public.players p
      where p.id = parent_player_links.player_id
        and p.club_id = parent_player_links.club_id
        and (
          p.team_id = parent_player_links.team_id
          or parent_player_links.team_id is null
        )
    )
  )
);

drop policy if exists club_user_invites_insert_scoped on public.club_user_invites;
create policy club_user_invites_insert_scoped
on public.club_user_invites
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_user_invites.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and club_user_invites.role_rank <= public.current_user_role_rank()
    and public.can_insert_staff_invite_for_plan(club_user_invites.club_id, club_user_invites.email)
    and (
      (
        club_user_invites.team_id is not null
        and public.can_use_plan_feature(club_user_invites.club_id, 'teamStaffRoles')
      )
      or (
        club_user_invites.team_id is null
        and public.can_use_plan_feature(club_user_invites.club_id, 'clubStaffRoles')
      )
    )
  )
);

drop policy if exists parent_email_templates_select_scoped on public.parent_email_templates;
create policy parent_email_templates_select_scoped
on public.parent_email_templates
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    parent_email_templates.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(parent_email_templates.club_id, 'parentEmails')
  )
);

drop policy if exists parent_email_templates_insert_scoped on public.parent_email_templates;
create policy parent_email_templates_insert_scoped
on public.parent_email_templates
for insert
to authenticated
with check (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parentEmails')
);

drop policy if exists parent_email_templates_update_scoped on public.parent_email_templates;
create policy parent_email_templates_update_scoped
on public.parent_email_templates
for update
to authenticated
using (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parentEmails')
)
with check (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parentEmails')
);

drop policy if exists audit_logs_select_scoped on public.audit_logs;
create policy audit_logs_select_scoped
on public.audit_logs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.can_use_plan_feature(audit_logs.club_id, 'fullOperationalAuditLog')
    and (
      audit_logs.actor_id = auth.uid()
      or (
        audit_logs.club_id = public.current_user_club_id()
        and public.current_user_role_rank() >= 50
        and coalesce(audit_logs.actor_role_rank, 0) <= public.current_user_role_rank()
      )
    )
  )
);

drop policy if exists form_fields_insert_scoped on public.form_fields;
create policy form_fields_insert_scoped
on public.form_fields
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'super_admin'
    and form_fields.club_id is not null
  )
  or (
    public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and (
      coalesce(form_fields.is_default, false) = true
      or public.can_use_plan_feature(form_fields.club_id, 'customDevelopmentFields')
    )
  )
);

drop policy if exists form_fields_update_scoped on public.form_fields;
create policy form_fields_update_scoped
on public.form_fields
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'customDevelopmentFields')
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'customDevelopmentFields')
  )
);

drop policy if exists form_fields_delete_scoped on public.form_fields;
create policy form_fields_delete_scoped
on public.form_fields
for delete
to authenticated
using (
  form_fields.is_default = false
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role_rank() >= 20
      and form_fields.club_id = public.current_user_club_id()
      and public.can_use_plan_feature(form_fields.club_id, 'customDevelopmentFields')
    )
  )
);

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

  return new;
end;
$$;

drop policy if exists club_logos_manager_insert on storage.objects;
create policy club_logos_manager_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role_rank() >= 50
      and public.can_use_plan_feature(public.current_user_club_id(), 'basicLogoBranding')
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
);

drop policy if exists club_logos_manager_update on storage.objects;
create policy club_logos_manager_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role_rank() >= 50
      and public.can_use_plan_feature(public.current_user_club_id(), 'basicLogoBranding')
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
)
with check (
  bucket_id = 'club-logos'
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role_rank() >= 50
      and public.can_use_plan_feature(public.current_user_club_id(), 'basicLogoBranding')
      and (storage.foldername(name))[1] = public.current_user_club_id()::text
      and name = public.current_user_club_id()::text || '/logo.png'
    )
  )
);

drop policy if exists team_logos_manager_insert on storage.objects;
create policy team_logos_manager_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(public.current_user_club_id(), 'basicLogoBranding')
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
);

drop policy if exists team_logos_manager_update on storage.objects;
create policy team_logos_manager_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(public.current_user_club_id(), 'basicLogoBranding')
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
)
with check (
  bucket_id = 'club-logos'
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(public.current_user_club_id(), 'basicLogoBranding')
  and (storage.foldername(name))[1] = public.current_user_club_id()::text
  and (storage.foldername(name))[2] = 'teams'
  and exists (
    select 1
    from public.teams t
    where t.id::text = (storage.foldername(name))[3]
      and t.club_id = public.current_user_club_id()
      and name = public.current_user_club_id()::text || '/teams/' || t.id::text || '/logo.png'
  )
);

revoke all on function public.can_use_plan_feature(uuid, text) from public;
revoke all on function public.can_insert_evaluation_for_plan(uuid) from public;
revoke all on function public.can_insert_player_for_plan(uuid, text, text) from public;
revoke all on function public.can_insert_staff_invite_for_plan(uuid, text) from public;

grant execute on function public.can_use_plan_feature(uuid, text) to authenticated;
grant execute on function public.can_insert_evaluation_for_plan(uuid) to authenticated;
grant execute on function public.can_insert_player_for_plan(uuid, text, text) to authenticated;
grant execute on function public.can_insert_staff_invite_for_plan(uuid, text) to authenticated;
