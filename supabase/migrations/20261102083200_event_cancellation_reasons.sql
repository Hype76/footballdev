-- section: session
alter table public.assessment_sessions
  add column if not exists cancellation_reason text;

-- Return only the calendar details for sessions invited to the authenticated parent's player.
create function public.get_parent_portal_invited_sessions(parent_link_id_value uuid)
returns table (
  id uuid, title text, session_type text, session_date date,
  arrival_time time, start_time time, end_time time, location text,
  notes text, team text, status text, cancellation_reason text, updated_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select distinct s.id, s.title, s.session_type, s.session_date,
    s.arrival_time, s.start_time, s.end_time, s.location,
    s.notes, s.team, s.status, s.cancellation_reason, s.updated_at
  from public.parent_player_links link
  join public.calendar_event_invites invite
    on invite.parent_link_id = link.id
    and invite.player_id = link.player_id
    and invite.club_id = link.club_id
    and invite.invite_status <> 'cancelled'
  join public.assessment_sessions s
    on s.id = invite.assessment_session_id
    and s.club_id = link.club_id
    and s.team_id = invite.team_id
  where link.id = parent_link_id_value
    and link.auth_user_id = auth.uid()
    and link.status = 'active'
    and public.current_user_can_access_parent_link(link.id, link.player_id)
    and auth.uid() is not null;
$$;

revoke all on function public.get_parent_portal_invited_sessions(uuid) from public, anon;
grant execute on function public.get_parent_portal_invited_sessions(uuid) to authenticated;

-- section: match
alter table public.match_days add column if not exists cancellation_reason text not null default '';

create function public.cancel_match_day_fixture_for_team(p_match_day_id uuid, p_team_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  match_row public.match_days%rowtype;
  updated_row public.match_days%rowtype;
begin
  if actor_id is null or p_match_day_id is null or p_team_id is null then
    raise exception using errcode = '42501', message = 'match_day_fixture_not_permitted';
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  join public.teams team
    on team.id = match_day.team_id
   and team.id = p_team_id
   and coalesce(team.status, 'active') = 'active'
  join public.clubs club
    on club.id = match_day.club_id
   and club.id = team.club_id
   and coalesce(club.status, 'active') = 'active'
  where match_day.id = p_match_day_id
    and match_day.deleted_at is null
  for update of match_day;

  if match_row.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, match_row.club_id, p_team_id, 20) then
    raise exception using errcode = '42501', message = 'match_day_fixture_not_permitted';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('scheduled', 'scorer_request', 'postponed') then
    raise exception using errcode = '22023', message = 'match_day_fixture_already_started';
  end if;

  update public.match_days match_day
  set status = 'cancelled',
      cancellation_reason = left(trim(coalesce(p_reason, '')), 1000),
      updated_at = timezone('utc', now())
  where match_day.id = match_row.id
  returning match_day.* into updated_row;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    match_row.club_id,
    actor_id,
    'match_day_fixture_cancelled',
    'match_day',
    match_row.id,
    jsonb_build_object('teamId', p_team_id, 'previousStatus', match_row.status)
  );

  return to_jsonb(updated_row);
end;
$$;

revoke all on function public.cancel_match_day_fixture_for_team(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_match_day_fixture_for_team(uuid, uuid, text) to authenticated, service_role;

-- Keep the existing fixture RPC contract stable for its many callers.
create function public.get_parent_cancelled_match_days(parent_link_id_value uuid)
returns setof jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', fixture.id, 'club_id', fixture.club_id, 'team_id', fixture.team_id,
    'team_name', coalesce(team.name, ''), 'opponent', fixture.opponent,
    'fixture_type', fixture.fixture_type, 'match_date', fixture.match_date,
    'kickoff_time', fixture.kickoff_time, 'kickoff_time_tbc', fixture.kickoff_time_tbc,
    'arrival_time', fixture.arrival_time, 'home_away', fixture.home_away,
    'venue_name', fixture.venue_name, 'venue_address', fixture.venue_address,
    'status', fixture.status, 'cancellation_reason', fixture.cancellation_reason,
    'created_at', fixture.created_at, 'updated_at', fixture.updated_at
  )
  from public.parent_player_links link
  join public.match_days fixture on fixture.club_id = link.club_id
  left join public.teams team on team.id = fixture.team_id
  where link.id = parent_link_id_value and link.auth_user_id = (select auth.uid()) and link.status = 'active'
    and public.current_user_can_access_parent_link(link.id, link.player_id)
    and fixture.status = 'cancelled' and fixture.deleted_at is null and fixture.previous_hidden_at is null
    and fixture.parent_visible is true and fixture.parent_audience <> 'none'
    and (fixture.match_date is null or fixture.match_date >= (timezone('Europe/London', now())::date - 365))
    and (
      fixture.parent_audience = 'all_club_parents'
      or (fixture.parent_audience = 'all_team_parents' and fixture.team_id is not null and fixture.team_id = link.team_id)
      or (fixture.parent_audience = 'involved_players' and fixture.team_id = link.team_id and (
        exists (select 1 from public.match_day_availability_requests request where request.match_day_id = fixture.id and request.club_id = link.club_id and request.player_id = link.player_id and request.status <> 'expired')
        or exists (select 1 from public.calendar_event_invites invite where invite.match_day_id = fixture.id and invite.club_id = fixture.club_id and invite.team_id = fixture.team_id and invite.player_id = link.player_id and invite.invite_status <> 'cancelled')
        or exists (select 1 from public.match_day_player_squad_decisions decision join public.players player on player.id = decision.player_id and player.club_id = fixture.club_id and player.team_id = fixture.team_id and coalesce(player.status, 'active') <> 'archived' join public.clubs club on club.id = fixture.club_id and coalesce(club.status, 'active') = 'active' where decision.match_day_id = fixture.id and decision.club_id = fixture.club_id and decision.team_id = fixture.team_id and decision.player_id = link.player_id and (decision.status = 'selected' or decision.notified_at is not null) and coalesce(team.status, 'active') = 'active' and public.current_user_can_access_parent_link(link.id, link.player_id))
      ))
    );
$$;
revoke all on function public.get_parent_cancelled_match_days(uuid) from public, anon;
grant execute on function public.get_parent_cancelled_match_days(uuid) to authenticated, service_role;

-- section: calendar
alter table public.calendar_events
  add column if not exists cancellation_reason text;

-- Capture eligible recipients before the existing cancellation trigger changes their statuses.
-- The private table prevents callers from manufacturing cancellation access.
create table app_private.cancelled_training_event_recipients (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  request_player_id uuid not null references public.training_availability_request_players(id) on delete cascade,
  primary key (event_id, request_player_id)
);
alter table app_private.cancelled_training_event_recipients enable row level security;
revoke all on table app_private.cancelled_training_event_recipients from public, anon, authenticated, service_role;

create function app_private.capture_cancelled_training_event_recipients()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from app_private.cancelled_training_event_recipients where event_id = new.id;
  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into app_private.cancelled_training_event_recipients(event_id, request_player_id)
    select new.id, recipient.id
    from public.training_availability_request_players recipient
    join public.training_availability_requests request on request.id = recipient.request_id
      and request.calendar_event_id = new.id and request.club_id = new.club_id
      and request.team_id = new.team_id and recipient.club_id = request.club_id
      and recipient.team_id = request.team_id and recipient.calendar_event_id = new.id
    where request.status <> 'cancelled'
      and recipient.status not in ('cancelled', 'expired')
      and recipient.token_revoked_at is null
      and coalesce(recipient.response_deadline_at, request.occurrence_starts_at) >= now()
    for update of recipient, request;
  end if;
  return new;
end;
$$;
revoke all on function app_private.capture_cancelled_training_event_recipients() from public, anon, authenticated, service_role;
create trigger capture_cancelled_training_event_recipients
before update of cancelled_at on public.calendar_events
for each row when (old.cancelled_at is distinct from new.cancelled_at)
execute function app_private.capture_cancelled_training_event_recipients();

-- Service-side notification jobs can validate a set of already-scoped links.
create function public.get_authorized_notification_parent_links(club_id_value uuid, parent_link_ids_value uuid[])
returns table (parent_link_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct link.id
  from public.parent_player_links link
  join public.players player on player.id = link.player_id and player.club_id = link.club_id
  where link.id = any(parent_link_ids_value) and link.club_id = club_id_value
    and link.status = 'active' and (link.auth_user_id is not null or coalesce(trim(link.email), '') <> '')
    and coalesce(player.status, 'active') <> 'archived'
    and public.can_use_plan_feature(link.club_id, 'parentPortal')
    and not exists (select 1 from public.users actor where actor.id = link.auth_user_id
      and actor.status = 'suspended' and (actor.role = 'parent_portal' or actor.club_id = link.club_id));
$$;
revoke all on function public.get_authorized_notification_parent_links(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_authorized_notification_parent_links(uuid, uuid[]) to service_role;

-- Notification delivery runs as service role, so evaluate each link's authority explicitly.
create function public.get_cancelled_training_notification_parent_links(event_id_value uuid, club_id_value uuid, team_id_value uuid)
returns table (parent_link_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct link.id
  from public.calendar_events event
  join public.training_availability_requests request on request.calendar_event_id = event.id
    and request.club_id = event.club_id and request.team_id = event.team_id
  join public.training_availability_request_players recipient on recipient.request_id = request.id
    and recipient.calendar_event_id = event.id and recipient.club_id = event.club_id and recipient.team_id = event.team_id
  join app_private.cancelled_training_event_recipients captured on captured.event_id = event.id and captured.request_player_id = recipient.id
  join public.parent_player_links link on link.club_id = event.club_id and link.team_id = event.team_id
    and link.player_id = recipient.player_id and link.status = 'active'
    and (link.auth_user_id is not null or coalesce(trim(link.email), '') <> '')
    and (link.id = recipient.parent_link_id or (recipient.parent_link_id is null
      and coalesce(link.email, '') <> '' and lower(link.email) = lower(recipient.recipient_email)))
  join public.players player on player.id = link.player_id and player.club_id = link.club_id
  where event.id = event_id_value and event.club_id = club_id_value and event.team_id = team_id_value
    and event.event_type = 'training' and event.cancelled_at is not null
    and event.parent_visible is true and event.parent_audience = 'involved_players'
    and recipient.recipient_type = 'parent' and recipient.token_revoked_at is null
    and recipient.status <> 'expired'
    and coalesce(recipient.response_deadline_at, request.occurrence_starts_at) >= now()
    and coalesce(player.status, 'active') <> 'archived'
    and public.can_use_plan_feature(link.club_id, 'parentPortal')
    and not exists (select 1 from public.users actor where actor.id = link.auth_user_id
      and actor.status = 'suspended' and (actor.role = 'parent_portal' or actor.club_id = link.club_id));
$$;
revoke all on function public.get_cancelled_training_notification_parent_links(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_cancelled_training_notification_parent_links(uuid, uuid, uuid) to service_role;

-- Return only parent-facing fields for the signed-in parent's active invitations.
create function public.get_parent_portal_invited_calendar_events(parent_link_id_value uuid)
returns table (id uuid, title text, event_type text, starts_at timestamptz,
  ends_at timestamptz, location text, notes text, parent_visible boolean,
  parent_audience text, cancelled_at timestamptz, cancellation_reason text,
  recurrence_frequency text, recurrence_until date, deleted_occurrence_dates date[])
language sql stable security definer set search_path = public as $$
  select distinct event.id, event.title, event.event_type, event.starts_at,
    event.ends_at, event.location, event.notes, event.parent_visible,
    event.parent_audience, event.cancelled_at, event.cancellation_reason,
    event.recurrence_frequency, event.recurrence_until, event.deleted_occurrence_dates
  from public.calendar_events event
  join public.parent_player_links link on link.club_id = event.club_id
  where link.id = parent_link_id_value and link.auth_user_id = auth.uid()
    and link.status = 'active'
    and public.current_user_can_access_parent_link(link.id, link.player_id)
    and (
      (event.parent_visible is true and event.parent_audience = 'involved_players'
        and exists (select 1 from public.calendar_event_invites invite
          where invite.calendar_event_id = event.id and invite.club_id = link.club_id
            and invite.parent_link_id = link.id and invite.player_id = link.player_id
            and invite.invite_status <> 'cancelled'))
      or (event.parent_visible is true and event.parent_audience = 'involved_players'
        and event.event_type = 'training' and event.cancelled_at is not null
        and event.cancellation_reason is not null and event.team_id = link.team_id
        and exists (select 1 from public.training_availability_request_players request_player
          join public.training_availability_requests request on request.id = request_player.request_id
            and request.club_id = link.club_id and request.team_id = link.team_id
            and request.calendar_event_id = event.id
          where request_player.club_id = link.club_id and request_player.team_id = link.team_id
            and request_player.player_id = link.player_id
            and request_player.token_revoked_at is null
            and request_player.status <> 'expired'
            and exists (select 1 from app_private.cancelled_training_event_recipients captured
              where captured.event_id = event.id and captured.request_player_id = request_player.id)
            and coalesce(request_player.response_deadline_at, request.occurrence_starts_at) >= now()
            and (request_player.parent_link_id = link.id or (request_player.parent_link_id is null
              and coalesce(link.email, '') <> '' and lower(request_player.recipient_email) = lower(link.email)))
            and request.occurrence_starts_at >= now() - interval '30 days'))
    )
    and (event.cancelled_at is null or event.cancellation_reason is not null);
$$;
revoke all on function public.get_parent_portal_invited_calendar_events(uuid) from public;
revoke execute on function public.get_parent_portal_invited_calendar_events(uuid) from anon;
grant execute on function public.get_parent_portal_invited_calendar_events(uuid) to authenticated, service_role;

-- Preserve the existing shared-event RPC and expose cancelled rows separately.
create function public.get_parent_portal_cancelled_shared_calendar_events(parent_link_id_value uuid)
returns table (id uuid, club_id uuid, team_id uuid, event_type text, title text,
  starts_at timestamptz, ends_at timestamptz, location text, notes text,
  parent_audience text, cancelled_at timestamptz, cancellation_reason text,
  recurrence_frequency text, recurrence_until date, deleted_occurrence_dates date[])
language sql stable security definer set search_path = public as $$
  select distinct event.id, event.club_id, event.team_id, event.event_type,
    event.title, event.starts_at, event.ends_at, event.location, event.notes,
    event.parent_audience, event.cancelled_at, event.cancellation_reason,
    event.recurrence_frequency, event.recurrence_until, event.deleted_occurrence_dates
  from public.calendar_events event
  join public.parent_player_links link on link.club_id = event.club_id
  where link.id = parent_link_id_value and link.auth_user_id = auth.uid()
    and link.status = 'active' and public.current_user_can_access_parent_link(link.id, link.player_id)
    and event.cancelled_at is not null
    and event.cancellation_reason is not null and event.parent_visible is true
    and (event.parent_audience = 'all_club_parents'
      or (event.parent_audience = 'all_team_parents' and event.team_id = link.team_id))
    and (event.starts_at >= now() - interval '1 day'
      or (event.recurrence_frequency <> 'none'
        and event.recurrence_until >= (now() - interval '1 day')::date));
$$;
revoke all on function public.get_parent_portal_cancelled_shared_calendar_events(uuid) from public;
revoke execute on function public.get_parent_portal_cancelled_shared_calendar_events(uuid) from anon;
grant execute on function public.get_parent_portal_cancelled_shared_calendar_events(uuid) to authenticated, service_role;
