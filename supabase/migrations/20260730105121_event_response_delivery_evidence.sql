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
      delivery.status,
      case
        when delivery.status = 'failed' or delivery.last_error is not null
          then 'Delivery issue'
        else ''
      end,
      delivery.requested_at,
      delivery.created_at,
      delivery.updated_at
    from public.calendar_event_notification_events delivery
    where delivery.club_id = source_club_id
      and delivery.calendar_event_id = source_id_value
    order by delivery.requested_at desc, delivery.id;
  elsif normalized_source_type = 'match-day' then
    return query
    select
      delivery.id,
      delivery.player_id,
      delivery.status,
      case
        when delivery.status = 'failed' or delivery.last_error is not null
          then 'Delivery issue'
        else ''
      end,
      delivery.requested_at,
      delivery.created_at,
      delivery.updated_at
    from public.calendar_event_notification_events delivery
    where delivery.club_id = source_club_id
      and delivery.match_day_id = source_id_value
    order by delivery.requested_at desc, delivery.id;
  end if;
end;
$$;

revoke all on function public.get_event_response_delivery_evidence(text, uuid) from public;
revoke all on function public.get_event_response_delivery_evidence(text, uuid) from anon;
grant execute on function public.get_event_response_delivery_evidence(text, uuid) to authenticated;

comment on function public.get_event_response_delivery_evidence(text, uuid) is
  'Returns event-scoped, recipient-free delivery status to currently authorised staff without exposing the private notification ledger.';
