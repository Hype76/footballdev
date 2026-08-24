-- Align Platform Analytics counts with the live Parent authority model and
-- current customer Coach account definitions. Keep all analytics functions
-- service-role-only and privacy-safe.

do $migration$
declare
  function_definition text;
  old_parent_links text := $old$valid_parent_links as (
  select link.*
  from current_contact_links link
  join public.users profile
    on profile.id = link.auth_user_id
   and profile.status = 'active'
  where link.status = 'active'
    and link.auth_user_id is not null
    and link.accepted_at is not null
    and (
      include_excluded_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),$old$;
  corrected_parent_links text := $new$valid_parent_links as (
  select link.*
  from current_contact_links link
  left join public.users profile
    on profile.id = link.auth_user_id
  where link.status = 'active'
    and link.auth_user_id is not null
    and coalesce(profile.status, 'active') <> 'suspended'
    and (
      include_excluded_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),$new$;
  old_staff text := $old$canonical_staff as (
  select distinct user_id, club_id
  from valid_staff_assignments
),$old$;
  corrected_staff text := $new$canonical_staff as (
  select distinct profile.id as user_id, profile.club_id
  from public.users profile
  join eligible_clubs club on club.id = profile.club_id
  where profile.status = 'active'
    and coalesce(profile.role, '') in ('admin', 'club_admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
    and (
      include_excluded_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
  union
  select distinct user_id, club_id
  from valid_staff_assignments
),$new$;
begin
  select pg_get_functiondef(
    'public.get_platform_analytics_identity_adoption(date,date,uuid,text,boolean,text,text)'::regprocedure
  ) into function_definition;
  function_definition := replace(function_definition, chr(13) || chr(10), chr(10));
  old_parent_links := replace(old_parent_links, chr(13) || chr(10), chr(10));
  corrected_parent_links := replace(corrected_parent_links, chr(13) || chr(10), chr(10));
  old_staff := replace(old_staff, chr(13) || chr(10), chr(10));
  corrected_staff := replace(corrected_staff, chr(13) || chr(10), chr(10));

  if position(old_parent_links in function_definition) > 0 then
    function_definition := replace(function_definition, old_parent_links, corrected_parent_links);
  elsif position(corrected_parent_links in function_definition) = 0 then
    raise exception 'Identity analytics Parent authority definition was not recognised';
  end if;

  if position(old_staff in function_definition) > 0 then
    function_definition := replace(function_definition, old_staff, corrected_staff);
  elsif position(corrected_staff in function_definition) = 0 then
    raise exception 'Identity analytics Coach account definition was not recognised';
  end if;

  function_definition := replace(
    function_definition,
    '''label'', ''Successful Parent Portal login observed''',
    '''label'', ''Parent Portal login telemetry captured'''
  );

  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_parent_links text := $old$valid_parent_links as (
  select contact.*
  from current_contacts contact
  join public.users profile
    on profile.id = contact.auth_user_id
   and profile.status = 'active'
  where contact.status = 'active'
    and contact.auth_user_id is not null
    and contact.accepted_at is not null
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),$old$;
  corrected_parent_links text := $new$valid_parent_links as (
  select contact.*
  from current_contacts contact
  left join public.users profile
    on profile.id = contact.auth_user_id
  where contact.status = 'active'
    and contact.auth_user_id is not null
    and coalesce(profile.status, 'active') <> 'suspended'
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),$new$;
  old_staff text := $old$canonical_staff as (
  select distinct user_id, club_id
  from valid_staff_assignments
),$old$;
  corrected_staff text := $new$canonical_staff as (
  select distinct profile.id as user_id, profile.club_id
  from public.users profile
  join eligible_clubs club on club.id = profile.club_id
  where profile.status = 'active'
    and coalesce(profile.role, '') in ('admin', 'club_admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
  union
  select distinct user_id, club_id
  from valid_staff_assignments
),$new$;
begin
  select pg_get_functiondef(
    'public.get_platform_analytics_dashboard_14c(date,date,uuid,text,text,text,text,text,text,boolean,boolean)'::regprocedure
  ) into function_definition;
  function_definition := replace(function_definition, chr(13) || chr(10), chr(10));
  old_parent_links := replace(old_parent_links, chr(13) || chr(10), chr(10));
  corrected_parent_links := replace(corrected_parent_links, chr(13) || chr(10), chr(10));
  old_staff := replace(old_staff, chr(13) || chr(10), chr(10));
  corrected_staff := replace(corrected_staff, chr(13) || chr(10), chr(10));

  if position(old_parent_links in function_definition) > 0 then
    function_definition := replace(function_definition, old_parent_links, corrected_parent_links);
  elsif position(corrected_parent_links in function_definition) = 0 then
    raise exception 'Dashboard analytics Parent authority definition was not recognised';
  end if;

  if position(old_staff in function_definition) > 0 then
    function_definition := replace(function_definition, old_staff, corrected_staff);
  elsif position(corrected_staff in function_definition) = 0 then
    raise exception 'Dashboard analytics Coach account definition was not recognised';
  end if;

  function_definition := replace(
    function_definition,
    '''generatedAt'', timezone(''utc'', now())',
    '''generatedAt'', now()'
  );

  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_parent_links text := $old$valid_parent_links as (
  select contact.*
  from current_parent_contacts contact
  join public.users profile
    on profile.id = contact.auth_user_id
   and profile.status = 'active'
  where contact.status = 'active'
    and contact.auth_user_id is not null
    and contact.accepted_at is not null
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),$old$;
  corrected_parent_links text := $new$valid_parent_links as (
  select contact.*
  from current_parent_contacts contact
  left join public.users profile
    on profile.id = contact.auth_user_id
  where contact.status = 'active'
    and contact.auth_user_id is not null
    and coalesce(profile.status, 'active') <> 'suspended'
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),$new$;
  old_parent_only text := $old$      select count(*) from parent_access_accounts parent
      join public.users profile on profile.id = parent.auth_user_id
      where profile.role <> 'super_admin'
        and not exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)$old$;
  corrected_parent_only text := $new$      select count(*) from parent_access_accounts parent
      left join public.users profile on profile.id = parent.auth_user_id
      where coalesce(profile.role, '') <> 'super_admin'
        and not exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)$new$;
  old_parent_only_drilldown text := $old$        select count(*) from parent_access_accounts parent
        join public.users profile on profile.id = parent.auth_user_id
        where profile.role <> 'super_admin'
          and not exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)$old$;
  corrected_parent_only_drilldown text := $new$        select count(*) from parent_access_accounts parent
        left join public.users profile on profile.id = parent.auth_user_id
        where coalesce(profile.role, '') <> 'super_admin'
          and not exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)$new$;
begin
  select pg_get_functiondef(
    'public.get_platform_analytics_canonical_v4(date,date,uuid,text,text,text,text,text,text,boolean,boolean)'::regprocedure
  ) into function_definition;
  function_definition := replace(function_definition, chr(13) || chr(10), chr(10));
  old_parent_links := replace(old_parent_links, chr(13) || chr(10), chr(10));
  corrected_parent_links := replace(corrected_parent_links, chr(13) || chr(10), chr(10));
  old_parent_only := replace(old_parent_only, chr(13) || chr(10), chr(10));
  corrected_parent_only := replace(corrected_parent_only, chr(13) || chr(10), chr(10));
  old_parent_only_drilldown := replace(old_parent_only_drilldown, chr(13) || chr(10), chr(10));
  corrected_parent_only_drilldown := replace(corrected_parent_only_drilldown, chr(13) || chr(10), chr(10));

  if position(old_parent_links in function_definition) > 0 then
    function_definition := replace(function_definition, old_parent_links, corrected_parent_links);
  elsif position(corrected_parent_links in function_definition) = 0 then
    raise exception 'Canonical analytics Parent authority definition was not recognised';
  end if;

  if position(old_parent_only in function_definition) > 0 then
    function_definition := replace(function_definition, old_parent_only, corrected_parent_only);
  elsif position(corrected_parent_only in function_definition) = 0 then
    raise exception 'Canonical analytics Parent-only definition was not recognised';
  end if;

  if position(old_parent_only_drilldown in function_definition) > 0 then
    function_definition := replace(function_definition, old_parent_only_drilldown, corrected_parent_only_drilldown);
  elsif position(corrected_parent_only_drilldown in function_definition) = 0 then
    raise exception 'Canonical analytics Parent-only breakdown definition was not recognised';
  end if;

  function_definition := replace(
    function_definition,
    '''generatedAt'', timezone(''utc'', now())',
    '''generatedAt'', now()'
  );
  function_definition := replace(
    function_definition,
    'Distinct active authenticated users with an accepted active Parent relationship to a counted active player.',
    'Distinct authenticated users with active Parent authority for a counted active player. Only explicitly suspended profiles are excluded.'
  );
  function_definition := replace(
    function_definition,
    'Distinct accepted authenticated Parent-to-player relationships for counted active players.',
    'Distinct authenticated Parent-to-player relationships with active authority for counted active players.'
  );

  execute function_definition;
end;
$migration$;

revoke all on function public.get_platform_analytics_identity_adoption(
  date, date, uuid, text, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.get_platform_analytics_identity_adoption(
  date, date, uuid, text, boolean, text, text
) to service_role;

revoke all on function public.get_platform_analytics_dashboard_14c(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.get_platform_analytics_dashboard_14c(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) to service_role;

revoke all on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) to service_role;

comment on function public.get_platform_analytics_identity_adoption(
  date, date, uuid, text, boolean, text, text
) is
'Private identity and adoption metrics aligned with live Parent authority and current customer Coach accounts. Parent Portal login telemetry remains explicitly separate from account authority.';

comment on function public.get_platform_analytics_dashboard_14c(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) is
'Private aggregate dashboard metrics aligned with live Parent authority and current customer Coach accounts. Timestamps retain their time-zone offset.';

comment on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) is
'Canonical service-role-only Platform Analytics report. Headline counts and breakdowns share live Parent authority, current customer Coach account, customer-workspace, and time-zone-aware definitions without returning personal details.';
