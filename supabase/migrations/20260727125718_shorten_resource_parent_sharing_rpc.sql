create or replace function public.sync_resource_library_player_assignments(
  target_resource_id uuid,
  target_club_id uuid,
  target_team_id uuid,
  targets_value jsonb,
  share_description_value text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resource_row public.resource_library_items%rowtype;
  target_value jsonb;
  target_id_value uuid;
  selected_player_ids uuid[] := array[]::uuid[];
  normalized_targets jsonb := '[]'::jsonb;
  assignment_rows jsonb := '[]'::jsonb;
  removed_count_value integer := 0;
  actor_email_value text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if target_resource_id is null or target_club_id is null or target_team_id is null then
    raise exception 'Resource, club, and team are required.';
  end if;

  if targets_value is null
    or jsonb_typeof(targets_value) <> 'array'
    or jsonb_array_length(targets_value) > 200 then
    raise exception 'Choose up to 200 valid player targets.';
  end if;

  if char_length(btrim(coalesce(share_description_value, ''))) > 500 then
    raise exception 'Share descriptions must be 500 characters or fewer.';
  end if;

  select item.*
  into resource_row
  from public.resource_library_items item
  where item.id = target_resource_id
    and item.club_id = target_club_id
    and item.team_id = target_team_id
    and item.archived_at is null;

  if resource_row.id is null
    or not public.current_user_can_manage_resource_library(target_club_id, target_team_id) then
    raise exception 'Resource library manager access required.';
  end if;

  for target_value in
    select target.value
    from jsonb_array_elements(targets_value) as target(value)
  loop
    if jsonb_typeof(target_value) <> 'object'
      or lower(btrim(coalesce(target_value ->> 'linkedType', ''))) <> 'player'
      or coalesce(target_value ->> 'linkedId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(target_value -> 'parentVisible') <> 'boolean' then
      raise exception 'Resource target is invalid.';
    end if;

    target_id_value := (target_value ->> 'linkedId')::uuid;

    if not public.resource_library_link_target_allowed(
      'player',
      target_id_value,
      target_club_id,
      target_team_id
    ) then
      raise exception 'Resource target is outside the permitted team scope.';
    end if;

    if not target_id_value = any(selected_player_ids) then
      selected_player_ids := array_append(selected_player_ids, target_id_value);
      normalized_targets := normalized_targets || jsonb_build_array(jsonb_build_object(
        'linkedType', 'player',
        'linkedId', target_id_value,
        'parentVisible', (target_value ->> 'parentVisible')::boolean
      ));
    end if;
  end loop;

  if jsonb_array_length(normalized_targets) > 0 then
    select coalesce(jsonb_agg(to_jsonb(assignment_result)), '[]'::jsonb)
    into assignment_rows
    from public.assign_resource_library_item_with_parent_notifications(
      target_resource_id,
      target_club_id,
      target_team_id,
      normalized_targets,
      share_description_value
    ) assignment_result;
  end if;

  actor_email_value := coalesce(nullif(lower(btrim(auth.jwt() ->> 'email')), ''), 'resource-library-system');

  with removed_links as (
    update public.resource_library_links link
    set removed_at = timezone('utc', now()),
        removed_by_profile_id = auth.uid(),
        removed_by_name = '',
        removed_by_email = actor_email_value
    where link.resource_id = target_resource_id
      and link.club_id = target_club_id
      and link.team_id = target_team_id
      and link.linked_type = 'player'
      and link.removed_at is null
      and not (link.linked_id = any(selected_player_ids))
    returning link.id
  )
  select count(*)::integer
  into removed_count_value
  from removed_links;

  return jsonb_build_object(
    'assignments', assignment_rows,
    'removedCount', removed_count_value,
    'selectedPlayerCount', cardinality(selected_player_ids)
  );
end;
$$;

revoke all on function public.sync_resource_library_player_assignments(uuid, uuid, uuid, jsonb, text) from public;
revoke execute on function public.sync_resource_library_player_assignments(uuid, uuid, uuid, jsonb, text) from anon;
grant execute on function public.sync_resource_library_player_assignments(uuid, uuid, uuid, jsonb, text) to authenticated, service_role;

drop function if exists public.sync_resource_library_player_assignments_with_parent_notificati(uuid, uuid, uuid, jsonb, text);
