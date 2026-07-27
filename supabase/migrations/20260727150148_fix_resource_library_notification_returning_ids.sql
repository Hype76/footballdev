create or replace function public.assign_resource_library_item_with_parent_notifications(
  target_resource_id uuid,
  target_club_id uuid,
  target_team_id uuid,
  targets_value jsonb,
  share_description_value text default ''
)
returns table (
  id uuid,
  resource_id uuid,
  club_id uuid,
  team_id uuid,
  linked_type text,
  linked_id uuid,
  assigned_by_profile_id uuid,
  assigned_by_name text,
  assigned_by_email text,
  assigned_at timestamptz,
  parent_visible boolean,
  share_description text,
  removed_at timestamptz,
  removed_by_profile_id uuid,
  removed_by_name text,
  removed_by_email text,
  assignment_action text,
  notifications_queued integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  resource_row public.resource_library_items%rowtype;
  link_row public.resource_library_links%rowtype;
  target_value jsonb;
  target_type_value text;
  target_id_value uuid;
  normalized_share_description text := btrim(coalesce(share_description_value, ''));
  requested_parent_visible boolean;
  previous_parent_visible boolean;
  previous_share_description text;
  assignment_action_value text;
  notification_count_value integer;
  notification_id_value uuid;
  queue_id_value uuid;
  player_name_value text;
  safe_player_name text;
  safe_resource_title text;
  actor_email_value text;
  email_subject_value text;
  email_html_value text;
  parent_row record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if target_resource_id is null or target_club_id is null or target_team_id is null then
    raise exception 'Resource, club, and team are required.';
  end if;

  if targets_value is null
    or jsonb_typeof(targets_value) <> 'array'
    or jsonb_array_length(targets_value) = 0
    or jsonb_array_length(targets_value) > 200 then
    raise exception 'Choose between 1 and 200 valid resource targets.';
  end if;

  if char_length(normalized_share_description) > 500 then
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

  actor_email_value := coalesce(nullif(lower(btrim(auth.jwt() ->> 'email')), ''), 'resource-library-system');
  safe_resource_title := replace(replace(replace(resource_row.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  for target_value in
    select target.value
    from jsonb_array_elements(targets_value) as target(value)
  loop
    target_type_value := lower(btrim(coalesce(target_value ->> 'linkedType', '')));

    if target_type_value not in ('player', 'team')
      or coalesce(target_value ->> 'linkedId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Resource target is invalid.';
    end if;

    target_id_value := (target_value ->> 'linkedId')::uuid;
    requested_parent_visible := target_type_value = 'player'
      and lower(coalesce(target_value ->> 'parentVisible', 'false')) = 'true';

    if not public.resource_library_link_target_allowed(
      target_type_value,
      target_id_value,
      target_club_id,
      target_team_id
    ) then
      raise exception 'Resource target is outside the permitted team scope.';
    end if;

    link_row := null;

    select link.*
    into link_row
    from public.resource_library_links link
    where link.resource_id = target_resource_id
      and link.club_id = target_club_id
      and link.team_id = target_team_id
      and link.linked_type = target_type_value
      and link.linked_id = target_id_value
      and link.removed_at is null
    for update;

    if link_row.id is null then
      previous_parent_visible := false;
      assignment_action_value := 'inserted';

      insert into public.resource_library_links (
        resource_id,
        club_id,
        team_id,
        linked_type,
        linked_id,
        assigned_by_profile_id,
        assigned_by_name,
        assigned_by_email,
        parent_visible,
        share_description
      )
      values (
        target_resource_id,
        target_club_id,
        target_team_id,
        target_type_value,
        target_id_value,
        auth.uid(),
        '',
        actor_email_value,
        requested_parent_visible,
        case when requested_parent_visible then nullif(normalized_share_description, '') else null end
      )
      returning * into link_row;
    else
      previous_parent_visible := coalesce(link_row.parent_visible, false);
      previous_share_description := coalesce(link_row.share_description, '');
      assignment_action_value := case
        when previous_parent_visible = requested_parent_visible
          and previous_share_description = case when requested_parent_visible then normalized_share_description else '' end
          then 'unchanged'
        else 'updated'
      end;

      update public.resource_library_links link
      set parent_visible = requested_parent_visible,
          share_description = case when requested_parent_visible then nullif(normalized_share_description, '') else null end
      where link.id = link_row.id
      returning link.* into link_row;
    end if;

    notification_count_value := 0;

    if target_type_value = 'player'
      and requested_parent_visible
      and not previous_parent_visible then
      select player.player_name
      into player_name_value
      from public.players player
      where player.id = target_id_value
        and player.club_id = target_club_id
        and player.team_id = target_team_id;

      safe_player_name := replace(replace(replace(coalesce(player_name_value, 'your child'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
      email_subject_value := concat('New resource shared for ', coalesce(nullif(player_name_value, ''), 'your child'));
      email_html_value := concat(
        '<p>A new resource has been shared for ', safe_player_name, '.</p>',
        '<p><strong>', safe_resource_title, '</strong></p>',
        '<p><a href="https://parent.footballplayer.online/">Open Parent Portal</a></p>'
      );

      for parent_row in
        select distinct on (lower(btrim(parent_link.email)))
          parent_link.id,
          lower(btrim(parent_link.email)) as email
        from public.parent_player_links parent_link
        where parent_link.club_id = target_club_id
          and parent_link.player_id = target_id_value
          and (parent_link.team_id = target_team_id or parent_link.team_id is null)
          and parent_link.status = 'active'
          and parent_link.auth_user_id is not null
          and nullif(btrim(parent_link.email), '') is not null
          and btrim(parent_link.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        order by lower(btrim(parent_link.email)), parent_link.created_at
      loop
        notification_id_value := null;
        queue_id_value := null;

        insert into public.resource_library_parent_notifications as inserted_notification (
          link_id,
          resource_id,
          club_id,
          team_id,
          player_id,
          parent_link_id,
          recipient_email
        )
        values (
          link_row.id,
          target_resource_id,
          target_club_id,
          target_team_id,
          target_id_value,
          parent_row.id,
          parent_row.email
        )
        on conflict do nothing
        returning inserted_notification.id into notification_id_value;

        if notification_id_value is not null then
          insert into public.scheduled_email_queue as inserted_queue (
            club_id,
            team_id,
            created_by,
            created_by_email,
            to_email,
            subject,
            status,
            scheduled_at,
            payload
          )
          values (
            target_club_id,
            target_team_id,
            auth.uid(),
            actor_email_value,
            parent_row.email,
            email_subject_value,
            'scheduled',
            timezone('utc', now()),
            jsonb_build_object(
              'resendPayload', jsonb_build_object(
                'to', jsonb_build_array(parent_row.email),
                'subject', email_subject_value,
                'html', email_html_value
              ),
              'displayName', 'Football Player',
              'playerName', coalesce(player_name_value, ''),
              'parentName', '',
              'requiredFeature', 'parentEmails',
              'resourceNotification', jsonb_build_object(
                'type', 'resource_shared',
                'resourceTitle', resource_row.title
              )
            )
          )
          returning inserted_queue.id into queue_id_value;

          update public.resource_library_parent_notifications notification
          set email_queue_id = queue_id_value
          where notification.id = notification_id_value;

          notification_count_value := notification_count_value + 1;
        end if;
      end loop;
    end if;

    return query
    select
      link_row.id,
      link_row.resource_id,
      link_row.club_id,
      link_row.team_id,
      link_row.linked_type,
      link_row.linked_id,
      link_row.assigned_by_profile_id,
      link_row.assigned_by_name,
      link_row.assigned_by_email,
      link_row.assigned_at,
      link_row.parent_visible,
      link_row.share_description,
      link_row.removed_at,
      link_row.removed_by_profile_id,
      link_row.removed_by_name,
      link_row.removed_by_email,
      assignment_action_value,
      notification_count_value;
  end loop;
end;
$$;

revoke all on function public.assign_resource_library_item_with_parent_notifications(uuid, uuid, uuid, jsonb, text) from public;
revoke execute on function public.assign_resource_library_item_with_parent_notifications(uuid, uuid, uuid, jsonb, text) from anon;
grant execute on function public.assign_resource_library_item_with_parent_notifications(uuid, uuid, uuid, jsonb, text) to authenticated, service_role;
