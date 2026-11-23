alter table public.fan_notifications
  add column direct_resource_link_id uuid references public.resource_library_links(id) on delete cascade,
  add column direct_push_after timestamptz,
  add column direct_push_attempts integer not null default 0,
  add column direct_push_delivered text[] not null default '{}';

alter table public.fan_notifications drop constraint fan_notifications_exact_target_check;
alter table public.fan_notifications add constraint fan_notifications_exact_target_check check (
  (match_id is not null and calendar_event_id is null and resource_id is null and occurrence_date is null and direct_resource_link_id is null)
  or (match_id is null and calendar_event_id is not null and resource_id is not null and occurrence_date is not null and direct_resource_link_id is null)
  or (match_id is null and calendar_event_id is null and resource_id is not null and occurrence_date is null and direct_resource_link_id is not null)
);
create index fan_notifications_direct_push_idx on public.fan_notifications(direct_push_after, id)
  where direct_resource_link_id is not null and push_sent_at is null;

create function app_private.queue_direct_player_resource_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.linked_type <> 'player' or not new.parent_visible or new.removed_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.parent_visible and old.removed_at is null then
      return new;
    end if;
  end if;

  insert into public.fan_notifications
    (connection_id, event_key, title, body, resource_id, direct_resource_link_id, direct_push_after)
  select distinct on (fan.auth_user_id) fan.id, 'direct-resource:' || new.id::text, 'Resource added',
    'A new resource is ready to view.', new.resource_id, new.id, now()
  from public.fan_connections fan
  join public.players player on player.id = fan.player_id and player.club_id = fan.club_id
  join public.parent_player_links parent on parent.id = fan.parent_link_id
    and parent.player_id = fan.player_id and parent.club_id = fan.club_id and parent.auth_user_id = fan.invited_by
  join public.resource_library_items resource on resource.id = new.resource_id
    and resource.club_id = new.club_id and resource.team_id = new.team_id
  where fan.player_id = new.linked_id and fan.club_id = new.club_id and player.team_id = new.team_id
    and fan.status = 'active' and fan.relationship_type = 'player' and fan.auth_user_id is not null
    and fan.notifications_enabled and fan.permissions @> '{"resources": true, "development": true}'::jsonb
    and parent.link_type = 'parent' and parent.status = 'active'
    and (parent.team_id is null or parent.team_id = player.team_id)
    and player.status <> 'archived' and player.archived_at is null and resource.archived_at is null
  order by fan.auth_user_id, fan.id
  on conflict (connection_id, event_key) do nothing;
  return new;
end;
$$;
revoke all on function app_private.queue_direct_player_resource_notification() from public, anon, authenticated, service_role;

create trigger queue_direct_player_resource_notification
after insert or update of parent_visible, removed_at on public.resource_library_links
for each row execute function app_private.queue_direct_player_resource_notification();

create function public.claim_direct_player_resource_pushes(batch_size_value integer)
returns table(id uuid, connection_id uuid, resource_id uuid, direct_resource_link_id uuid,
  direct_push_after timestamptz, direct_push_attempts integer, direct_push_delivered text[])
language sql security definer set search_path = '' as $$
  with due as (
    select notification.id from public.fan_notifications notification
    where notification.direct_resource_link_id is not null and notification.push_sent_at is null
      and notification.direct_push_after <= now() and notification.direct_push_attempts < 5
      and notification.created_at >= now() - interval '48 hours'
    order by notification.direct_push_after, notification.id
    limit greatest(1, least(coalesce(batch_size_value, 8), 12))
    for update skip locked
  )
  update public.fan_notifications notification
    set direct_push_attempts = notification.direct_push_attempts + 1,
        direct_push_after = now() + interval '2 minutes'
  from due where notification.id = due.id
  returning notification.id, notification.connection_id, notification.resource_id, notification.direct_resource_link_id,
    notification.direct_push_after, notification.direct_push_attempts, notification.direct_push_delivered;
$$;
revoke all on function public.claim_direct_player_resource_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_direct_player_resource_pushes(integer) to service_role;
