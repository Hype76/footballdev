drop function if exists public.archive_resource_library_item(uuid, uuid, uuid);

create or replace function public.archive_resource_library_item(
  target_resource_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns table (
  resource_id uuid,
  resource_title text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_user public.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to archive a team resource.';
  end if;

  select *
  into acting_user
  from public.users
  where users.id = auth.uid();

  if acting_user.id is null then
    raise exception 'User profile is required to archive a team resource.';
  end if;

  return query
  update public.resource_library_items rli
  set archived_at = coalesce(rli.archived_at, timezone('utc', now())),
      archived_by_profile_id = acting_user.id,
      archived_by_name = coalesce(nullif(acting_user.display_name, ''), nullif(acting_user.name, ''), nullif(acting_user.username, ''), acting_user.email, ''),
      archived_by_email = coalesce(acting_user.email, '')
  where rli.id = target_resource_id
    and rli.club_id = target_club_id
    and rli.team_id = target_team_id
    and public.current_user_can_manage_resource_library(rli.club_id, rli.team_id)
  returning rli.id, rli.title;

  if not found then
    raise exception 'Team resource could not be archived for this team.';
  end if;
end;
$$;

revoke all on function public.archive_resource_library_item(uuid, uuid, uuid) from public;
revoke execute on function public.archive_resource_library_item(uuid, uuid, uuid) from anon;
grant execute on function public.archive_resource_library_item(uuid, uuid, uuid) to authenticated, service_role;
