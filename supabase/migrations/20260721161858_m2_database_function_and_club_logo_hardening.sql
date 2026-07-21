-- Preserve the two approved production Resource Library authority helpers that
-- predate their source-ledger representation. Their policy callers require an
-- authenticated grant, but no anonymous or PUBLIC execution.
create or replace function public.resource_library_link_resource_manage_allowed(
  target_resource_id uuid,
  target_club_id uuid,
  target_team_id uuid,
  target_linked_type text,
  target_linked_id uuid,
  require_target_check boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select
    public.current_user_can_manage_resource_library(target_club_id, target_team_id)
    and exists (
      select 1
      from public.resource_library_items item
      where item.id = target_resource_id
        and item.club_id = target_club_id
        and item.team_id = target_team_id
        and item.archived_at is null
    )
    and (
      require_target_check is not true
      or public.resource_library_link_target_allowed(
        target_linked_type,
        target_linked_id,
        target_club_id,
        target_team_id
      )
    );
$function$;

create or replace function public.resource_library_link_resource_view_allowed(
  target_resource_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select
    public.current_user_can_view_resource_library(target_club_id, target_team_id)
    and exists (
      select 1
      from public.resource_library_items item
      where item.id = target_resource_id
        and item.club_id = target_club_id
        and item.team_id = target_team_id
        and item.archived_at is null
    );
$function$;

drop policy if exists resource_library_links_select_staff on public.resource_library_links;
create policy resource_library_links_select_staff
on public.resource_library_links
for select
to authenticated
using (
  removed_at is null
  and public.resource_library_link_resource_view_allowed(resource_id, club_id, team_id)
);

drop policy if exists resource_library_links_insert_manager on public.resource_library_links;
create policy resource_library_links_insert_manager
on public.resource_library_links
for insert
to authenticated
with check (
  assigned_by_profile_id = auth.uid()
  and removed_at is null
  and removed_by_profile_id is null
  and public.resource_library_link_resource_manage_allowed(
    resource_id,
    club_id,
    team_id,
    linked_type,
    linked_id,
    true
  )
);

drop policy if exists resource_library_links_update_manager on public.resource_library_links;
create policy resource_library_links_update_manager
on public.resource_library_links
for update
to authenticated
using (
  public.resource_library_link_resource_manage_allowed(
    resource_id,
    club_id,
    team_id,
    linked_type,
    linked_id,
    false
  )
)
with check (
  public.resource_library_link_resource_manage_allowed(
    resource_id,
    club_id,
    team_id,
    linked_type,
    linked_id,
    true
  )
);

-- FP-SPR-016: remove application execution from trigger-only functions and
-- revoke inherited anonymous execution from the complete application surface.
do $migration$
declare
  target record;
begin
  for target in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args,
      p.prosecdef,
      p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype as trigger_only
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    left join pg_catalog.pg_depend d
      on d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     and d.objid = p.oid
     and d.deptype = 'e'
    where (
      n.nspname = 'public'
      or n.nspname like 'app\_%' escape '\'
      or n.nspname like 'private\_%' escape '\'
    )
      and d.objid is null
  loop
    execute pg_catalog.format(
      'revoke execute on function %I.%I(%s) from anon',
      target.schema_name,
      target.function_name,
      target.identity_args
    );

    if target.prosecdef then
      execute pg_catalog.format(
        'revoke execute on function %I.%I(%s) from public',
        target.schema_name,
        target.function_name,
        target.identity_args
      );
    end if;

    if target.trigger_only then
      execute pg_catalog.format(
        'revoke execute on function %I.%I(%s) from public, authenticated, service_role',
        target.schema_name,
        target.function_name,
        target.identity_args
      );
    end if;
  end loop;
end;
$migration$;

-- These are the only deliberate signed-out token flows. They accept opaque
-- digest values, derive authority internally, and remain covered by hostile
-- token regression tests.
grant execute on function public.confirm_match_day_availability(text, text) to anon, authenticated;
grant execute on function public.get_match_day_availability_response(text) to anon, authenticated;
grant execute on function public.get_match_day_availability_response_v2(text) to anon, authenticated;
grant execute on function public.get_training_availability_response(text) to anon, authenticated;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer) to anon, authenticated;
grant execute on function public.submit_training_availability_response(text, text, text) to anon, authenticated;

grant execute on function public.resource_library_link_resource_manage_allowed(uuid, uuid, uuid, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.resource_library_link_resource_view_allowed(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.resource_library_link_resource_manage_allowed(uuid, uuid, uuid, text, uuid, boolean)
is 'Authenticated RLS helper. Resource, club, team, link target, and current actor authority are verified internally.';

comment on function public.resource_library_link_resource_view_allowed(uuid, uuid, uuid)
is 'Authenticated RLS helper. Resource, club, team, and current actor read authority are verified internally.';

comment on function public.data_transfer_external_dependency(uuid, text, uuid)
is 'Service-only data transfer helper. Dynamic identifiers come only from pg_catalog metadata and use format percent-I; values use bind parameters.';

-- FP-SPR-020: public object delivery remains compatible through the public
-- object URL, while Data API listing and all direct browser writes are denied.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'club-logos';

drop policy if exists club_logos_public_read on storage.objects;
drop policy if exists club_logos_manager_insert on storage.objects;
drop policy if exists club_logos_manager_update on storage.objects;
drop policy if exists club_logos_manager_delete on storage.objects;
drop policy if exists team_logos_manager_insert on storage.objects;
drop policy if exists team_logos_manager_update on storage.objects;
drop policy if exists team_logos_manager_delete on storage.objects;

comment on column public.clubs.logo_url
is 'Public display URL for a server-validated club logo. Writes are protected by club authority controls; storage keys are server-derived.';
