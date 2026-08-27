alter table public.teams
  add column if not exists notification_display_name text;

alter table public.teams
  drop constraint if exists teams_notification_display_name_length_check;

alter table public.teams
  add constraint teams_notification_display_name_length_check
  check (
    notification_display_name is null
    or char_length(btrim(notification_display_name)) between 1 and 40
  );

comment on column public.teams.notification_display_name is
  'Optional short Team label used only in outbound notification copy. The official Team name remains unchanged.';

create or replace function public.set_team_notification_display_name(
  team_id_value uuid,
  display_name_value text
)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  target_team public.teams%rowtype;
  normalized_display_name text := nullif(btrim(coalesce(display_name_value, '')), '');
  updated_team public.teams%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  select team.* into target_team
  from public.teams team
  where team.id = team_id_value
    and team.archived_at is null
  for update;

  if actor.id is null
    or target_team.id is null
    or not app_private.actor_can_manage_team_resource(
      actor.id,
      target_team.club_id,
      target_team.id,
      20
    ) then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this Team.';
  end if;

  if normalized_display_name is null or char_length(normalized_display_name) > 40 then
    raise exception using errcode = '22023', message = 'Notification Team name must be between 1 and 40 characters.';
  end if;

  update public.teams team
  set notification_display_name = normalized_display_name,
      updated_at = timezone('utc', now()),
      updated_by = actor.id,
      updated_by_name = coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
      updated_by_email = coalesce(actor.email, '')
  where team.id = target_team.id
  returning team.* into updated_team;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_team.club_id,
    actor.id,
    'team_notification_display_name_updated',
    'team',
    target_team.id,
    jsonb_build_object(
      'previousDisplayName', target_team.notification_display_name,
      'notificationDisplayName', normalized_display_name,
      'officialTeamName', target_team.name
    )
  );

  return updated_team;
end;
$$;

alter function public.set_team_notification_display_name(uuid, text) owner to postgres;
revoke all on function public.set_team_notification_display_name(uuid, text) from public, anon;
revoke all on function public.set_team_notification_display_name(uuid, text) from service_role;
grant execute on function public.set_team_notification_display_name(uuid, text) to authenticated;

comment on function public.set_team_notification_display_name(uuid, text) is
  'Updates only the notification-specific Team label for an authorised active Coach, manager, or Club Admin.';

create or replace function public.get_event_response_delivery_evidence(
  source_type_value text,
  source_id_value uuid
)
returns table (
  id uuid,
  player_id uuid,
  status text,
  last_error text,
  requested_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  source_club_id uuid;
  source_team_id uuid;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Sign in as authorised staff to review event delivery evidence.';
  end if;

  if source_id_value is null
    or normalized_source_type not in ('calendar', 'match-day', 'session') then
    raise exception using
      errcode = '22023',
      message = 'Choose a supported event source.';
  end if;

  if normalized_source_type = 'calendar' then
    select event.club_id, event.team_id
    into source_club_id, source_team_id
    from public.calendar_events event
    where event.id = source_id_value
      and event.cancelled_at is null
    limit 1;
  elsif normalized_source_type = 'match-day' then
    select match_day.club_id, match_day.team_id
    into source_club_id, source_team_id
    from public.match_days match_day
    where match_day.id = source_id_value
      and match_day.deleted_at is null
    limit 1;
  else
    select session.club_id, session.team_id
    into source_club_id, source_team_id
    from public.assessment_sessions session
    where session.id = source_id_value
    limit 1;
  end if;

  if source_club_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'The event source was not found.';
  end if;

  if not public.current_user_can_access_team(source_club_id, source_team_id) then
    raise exception using
      errcode = '42501',
      message = 'You are not authorised to review this event.';
  end if;

  if normalized_source_type = 'calendar' then
    return query
    select
      delivery.id,
      delivery.player_id,
      case
        when delivery.status = 'failed'
          and queue.id is not null
          and queue.delivery_state::text = 'scheduled'
          and coalesce(queue.attempts, 0) = 0
          and queue.provider_message_id is null
          and queue.provider_accepted_at is null
          and lower(btrim(coalesce(queue.payload ->> 'calendarActionableInvitationBlocked', ''))) = 'true'
          then 'not_sent'
        else delivery.status
      end,
      case
        when delivery.status = 'failed'
          and queue.id is not null
          and queue.delivery_state::text = 'scheduled'
          and coalesce(queue.attempts, 0) = 0
          and queue.provider_message_id is null
          and queue.provider_accepted_at is null
          and lower(btrim(coalesce(queue.payload ->> 'calendarActionableInvitationBlocked', ''))) = 'true'
          then ''
        when delivery.status = 'failed' or delivery.last_error is not null
          then 'Delivery issue'
        else ''
      end,
      delivery.requested_at,
      delivery.created_at,
      delivery.updated_at
    from public.calendar_event_notification_events delivery
    left join public.scheduled_email_queue queue
      on queue.id = delivery.email_queue_id
      and queue.club_id = delivery.club_id
    where delivery.club_id = source_club_id
      and delivery.calendar_event_id = source_id_value
    order by delivery.requested_at desc, delivery.id;
  elsif normalized_source_type = 'match-day' then
    return query
    select
      delivery.id,
      delivery.player_id,
      case
        when delivery.status = 'failed'
          and queue.id is not null
          and queue.delivery_state::text = 'scheduled'
          and coalesce(queue.attempts, 0) = 0
          and queue.provider_message_id is null
          and queue.provider_accepted_at is null
          and lower(btrim(coalesce(queue.payload ->> 'calendarActionableInvitationBlocked', ''))) = 'true'
          then 'not_sent'
        else delivery.status
      end,
      case
        when delivery.status = 'failed'
          and queue.id is not null
          and queue.delivery_state::text = 'scheduled'
          and coalesce(queue.attempts, 0) = 0
          and queue.provider_message_id is null
          and queue.provider_accepted_at is null
          and lower(btrim(coalesce(queue.payload ->> 'calendarActionableInvitationBlocked', ''))) = 'true'
          then ''
        when delivery.status = 'failed' or delivery.last_error is not null
          then 'Delivery issue'
        else ''
      end,
      delivery.requested_at,
      delivery.created_at,
      delivery.updated_at
    from public.calendar_event_notification_events delivery
    left join public.scheduled_email_queue queue
      on queue.id = delivery.email_queue_id
      and queue.club_id = delivery.club_id
    where delivery.club_id = source_club_id
      and delivery.match_day_id = source_id_value
    order by delivery.requested_at desc, delivery.id;
  end if;
end;
$$;

alter function public.get_event_response_delivery_evidence(text, uuid) owner to postgres;
revoke all on function public.get_event_response_delivery_evidence(text, uuid) from public, anon;
grant execute on function public.get_event_response_delivery_evidence(text, uuid) to authenticated;

comment on function public.get_event_response_delivery_evidence(text, uuid) is
  'Returns event-scoped, recipient-free delivery status and distinguishes provider failures from invitations blocked before any send attempt.';
