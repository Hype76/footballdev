create table if not exists public.match_day_player_availability (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  player_id uuid not null references public.players (id) on delete cascade,
  player_name text not null default '',
  status text not null default 'pending',
  selected_by_parent_link_id uuid references public.parent_player_links (id) on delete set null,
  selected_by_request_id uuid references public.match_day_availability_requests (id) on delete set null,
  selected_by_name text not null default '',
  selected_by_email text not null default '',
  selected_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_player_availability_status_check check (status in ('pending', 'available', 'unavailable', 'maybe'))
);

create unique index if not exists match_day_player_availability_match_player_key
on public.match_day_player_availability (match_day_id, player_id);

create index if not exists match_day_player_availability_match_idx
on public.match_day_player_availability (match_day_id, status);

create table if not exists public.match_day_player_availability_history (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  player_id uuid not null references public.players (id) on delete cascade,
  request_id uuid references public.match_day_availability_requests (id) on delete set null,
  parent_link_id uuid references public.parent_player_links (id) on delete set null,
  player_name text not null default '',
  previous_status text,
  status text not null,
  selected_by_name text not null default '',
  selected_by_email text not null default '',
  notification_queue_id uuid references public.scheduled_email_queue (id) on delete set null,
  notification_warning text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint match_day_player_availability_history_status_check check (status in ('available', 'unavailable', 'maybe')),
  constraint match_day_player_availability_history_previous_check check (previous_status is null or previous_status in ('pending', 'available', 'unavailable', 'maybe'))
);

create index if not exists match_day_player_availability_history_match_player_idx
on public.match_day_player_availability_history (match_day_id, player_id, created_at desc);

create table if not exists public.match_day_role_assignments (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  role text not null,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  auth_user_id uuid references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_role_assignments_role_check check (role in ('scorer', 'linesman', 'referee'))
);

create unique index if not exists match_day_role_assignments_match_role_key
on public.match_day_role_assignments (match_day_id, role);

create index if not exists match_day_role_assignments_parent_idx
on public.match_day_role_assignments (parent_link_id, match_day_id);

alter table public.match_day_player_availability enable row level security;
alter table public.match_day_player_availability force row level security;
alter table public.match_day_player_availability_history enable row level security;
alter table public.match_day_player_availability_history force row level security;
alter table public.match_day_role_assignments enable row level security;
alter table public.match_day_role_assignments force row level security;

revoke all on public.match_day_player_availability from public;
revoke all on public.match_day_player_availability from anon;
revoke all on public.match_day_player_availability from authenticated;
revoke all on public.match_day_player_availability_history from public;
revoke all on public.match_day_player_availability_history from anon;
revoke all on public.match_day_player_availability_history from authenticated;
revoke all on public.match_day_role_assignments from public;
revoke all on public.match_day_role_assignments from anon;
revoke all on public.match_day_role_assignments from authenticated;

grant select on public.match_day_player_availability to authenticated;
grant select on public.match_day_player_availability_history to authenticated;
grant select, insert, update, delete on public.match_day_role_assignments to authenticated;

drop policy if exists match_day_player_availability_staff_select_scoped on public.match_day_player_availability;
create policy match_day_player_availability_staff_select_scoped
on public.match_day_player_availability
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_day_player_availability_history_staff_select_scoped on public.match_day_player_availability_history;
create policy match_day_player_availability_history_staff_select_scoped
on public.match_day_player_availability_history
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_day_role_assignments_staff_scoped on public.match_day_role_assignments;
create policy match_day_role_assignments_staff_scoped
on public.match_day_role_assignments
for all
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_match_day(team_id)
  )
);

insert into public.match_day_player_availability (
  match_day_id,
  club_id,
  team_id,
  player_id,
  player_name,
  status,
  selected_by_parent_link_id,
  selected_by_request_id,
  selected_by_name,
  selected_by_email,
  selected_at,
  created_at,
  updated_at
)
select distinct on (request.match_day_id, request.player_id)
  request.match_day_id,
  request.club_id,
  request.team_id,
  request.player_id,
  request.player_name,
  request.status,
  request.parent_link_id,
  request.id,
  coalesce(nullif(request.recipient_name, ''), request.recipient_email),
  request.recipient_email,
  request.responded_at,
  coalesce(request.responded_at, request.created_at),
  coalesce(request.responded_at, request.updated_at, request.created_at)
from public.match_day_availability_requests request
where request.status in ('available', 'unavailable', 'maybe')
order by request.match_day_id,
  request.player_id,
  request.responded_at desc nulls last,
  request.updated_at desc nulls last,
  request.created_at desc
on conflict (match_day_id, player_id)
do update
set status = excluded.status,
    selected_by_parent_link_id = excluded.selected_by_parent_link_id,
    selected_by_request_id = excluded.selected_by_request_id,
    selected_by_name = excluded.selected_by_name,
    selected_by_email = excluded.selected_by_email,
    selected_at = excluded.selected_at,
    updated_at = excluded.updated_at;

create or replace function public.get_match_day_availability_response_v2(token_hash_value text)
returns table (
  request_id uuid,
  player_id uuid,
  player_name text,
  recipient_name text,
  recipient_email text,
  response_status text,
  responded_at timestamptz,
  expires_at timestamptz,
  match_day_id uuid,
  current_availability_status text,
  current_availability_selected_by_name text,
  current_availability_selected_by_email text,
  current_availability_selected_at timestamptz,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  arrival_time time,
  venue_name text,
  venue_address text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  request_row public.match_day_availability_requests%rowtype;
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests as request
  where request.token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests as request
    set status = 'expired',
        updated_at = timezone('utc', now())
    where request.id = request_row.id
      and request.status = 'pending'
    returning request.*
    into request_row;

    if request_row.id is null then
      select request.*
      into request_row
      from public.match_day_availability_requests as request
      where request.token_hash = normalized_token_hash
      limit 1;
    end if;
  end if;

  return query
  select
    request_row.id,
    request_row.player_id,
    request_row.player_name,
    request_row.recipient_name,
    request_row.recipient_email,
    request_row.status,
    request_row.responded_at,
    request_row.expires_at,
    match_day.id,
    coalesce(current_availability.status, nullif(request_row.status, 'pending'), 'pending') as current_availability_status,
    coalesce(current_availability.selected_by_name, '') as current_availability_selected_by_name,
    coalesce(current_availability.selected_by_email, '') as current_availability_selected_by_email,
    current_availability.selected_at as current_availability_selected_at,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.venue_name,
    match_day.venue_address,
    coalesce(match_day.request_scorer, false),
    coalesce(match_day.request_linesman, false),
    coalesce(match_day.request_referee, false),
    coalesce(request_row.volunteer_scorer_response, 'no_response'),
    coalesce(request_row.volunteer_linesman_response, 'no_response'),
    coalesce(request_row.volunteer_referee_response, 'no_response'),
    request_row.volunteer_responded_at
  from public.match_days as match_day
  left join public.teams as team
    on team.id = match_day.team_id
  left join public.match_day_player_availability as current_availability
    on current_availability.match_day_id = request_row.match_day_id
    and current_availability.player_id = request_row.player_id
  where match_day.id = request_row.match_day_id
    and match_day.club_id = request_row.club_id;
end;
$$;

create or replace function public.submit_match_day_availability_response(
  token_hash_value text,
  status_value text,
  volunteer_scorer_response_value text default null,
  volunteer_linesman_response_value text default null,
  volunteer_referee_response_value text default null
)
returns table (
  request_id uuid,
  player_name text,
  response_status text,
  responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  normalized_status text := lower(trim(coalesce(status_value, '')));
  scorer_response text := lower(trim(coalesce(volunteer_scorer_response_value, '')));
  linesman_response text := lower(trim(coalesce(volunteer_linesman_response_value, '')));
  referee_response text := lower(trim(coalesce(volunteer_referee_response_value, '')));
  request_row public.match_day_availability_requests%rowtype;
  updated_row public.match_day_availability_requests%rowtype;
  match_row public.match_days%rowtype;
  link_row public.parent_player_links%rowtype;
  previous_current public.match_day_player_availability%rowtype;
  next_current public.match_day_player_availability%rowtype;
  next_scorer_response text;
  next_linesman_response text;
  next_referee_response text;
  should_stamp_volunteer boolean := false;
  should_update_availability boolean := false;
  actor_name text := '';
  actor_email text := '';
  queued_notification_id uuid;
  warning_message text := '';
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  should_update_availability := normalized_status in ('available', 'unavailable', 'maybe');

  if scorer_response not in ('yes', 'no') then
    scorer_response := null;
  end if;

  if linesman_response not in ('yes', 'no') then
    linesman_response := null;
  end if;

  if referee_response not in ('yes', 'no') then
    referee_response := null;
  end if;

  if not should_update_availability
    and scorer_response is null
    and linesman_response is null
    and referee_response is null then
    return;
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests as request
  where request.token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then
    return;
  end if;

  select match_day.*
  into match_row
  from public.match_days as match_day
  where match_day.id = request_row.match_day_id
    and match_day.club_id = request_row.club_id
  limit 1;

  if match_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests as request
    set status = 'expired',
        updated_at = timezone('utc', now())
    where request.id = request_row.id
      and request.status = 'pending'
    returning request.*
    into updated_row;

    if updated_row.id is null then
      updated_row := request_row;
    end if;

    request_id := updated_row.id;
    player_name := updated_row.player_name;
    response_status := 'expired';
    responded_at := updated_row.responded_at;
    volunteer_scorer_response := updated_row.volunteer_scorer_response;
    volunteer_linesman_response := updated_row.volunteer_linesman_response;
    volunteer_referee_response := updated_row.volunteer_referee_response;
    volunteer_responded_at := updated_row.volunteer_responded_at;
    return next;
    return;
  end if;

  if request_row.parent_link_id is not null then
    select parent_link.*
    into link_row
    from public.parent_player_links as parent_link
    where parent_link.id = request_row.parent_link_id
      and parent_link.club_id = request_row.club_id
      and parent_link.player_id = request_row.player_id
      and parent_link.status = 'active'
    limit 1;

    if link_row.id is null then
      return;
    end if;
  end if;

  actor_email := coalesce(nullif(request_row.recipient_email, ''), link_row.email, '');
  actor_name := coalesce(nullif(request_row.recipient_name, ''), nullif(actor_email, ''), 'Parent');

  next_scorer_response := case
    when coalesce(match_row.request_scorer, false) then coalesce(scorer_response, request_row.volunteer_scorer_response, 'no_response')
    else 'no_response'
  end;
  next_linesman_response := case
    when coalesce(match_row.request_linesman, false) then coalesce(linesman_response, request_row.volunteer_linesman_response, 'no_response')
    else 'no_response'
  end;
  next_referee_response := case
    when coalesce(match_row.request_referee, false) then coalesce(referee_response, request_row.volunteer_referee_response, 'no_response')
    else 'no_response'
  end;
  should_stamp_volunteer :=
    (coalesce(match_row.request_scorer, false) and scorer_response in ('yes', 'no'))
    or (coalesce(match_row.request_linesman, false) and linesman_response in ('yes', 'no'))
    or (coalesce(match_row.request_referee, false) and referee_response in ('yes', 'no'));

  update public.match_day_availability_requests as request
  set status = case when should_update_availability then normalized_status else request.status end,
      responded_at = case when should_update_availability then timezone('utc', now()) else request.responded_at end,
      volunteer_scorer_response = next_scorer_response,
      volunteer_linesman_response = next_linesman_response,
      volunteer_referee_response = next_referee_response,
      volunteer_responded_at = case
        when should_stamp_volunteer then timezone('utc', now())
        else request.volunteer_responded_at
      end,
      updated_at = timezone('utc', now())
  where request.id = request_row.id
  returning request.*
  into updated_row;

  if should_update_availability then
    select current_availability.*
    into previous_current
    from public.match_day_player_availability as current_availability
    where current_availability.match_day_id = request_row.match_day_id
      and current_availability.player_id = request_row.player_id
    limit 1;

    insert into public.match_day_player_availability (
      match_day_id,
      club_id,
      team_id,
      player_id,
      player_name,
      status,
      selected_by_parent_link_id,
      selected_by_request_id,
      selected_by_name,
      selected_by_email,
      selected_at,
      updated_at
    )
    values (
      request_row.match_day_id,
      request_row.club_id,
      request_row.team_id,
      request_row.player_id,
      request_row.player_name,
      normalized_status,
      request_row.parent_link_id,
      request_row.id,
      actor_name,
      actor_email,
      timezone('utc', now()),
      timezone('utc', now())
    )
    on conflict (match_day_id, player_id)
    do update
    set status = excluded.status,
        selected_by_parent_link_id = excluded.selected_by_parent_link_id,
        selected_by_request_id = excluded.selected_by_request_id,
        selected_by_name = excluded.selected_by_name,
        selected_by_email = excluded.selected_by_email,
        selected_at = excluded.selected_at,
        updated_at = timezone('utc', now())
    returning *
    into next_current;

    if previous_current.id is not null
      and previous_current.status <> normalized_status
      and coalesce(previous_current.selected_by_email, '') <> ''
      and coalesce(previous_current.selected_by_parent_link_id::text, '') <> coalesce(request_row.parent_link_id::text, '') then
      begin
        insert into public.scheduled_email_queue (
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
          request_row.club_id,
          request_row.team_id,
          null,
          'match-day-system',
          previous_current.selected_by_email,
          concat(request_row.player_name, ' availability updated'),
          'scheduled',
          timezone('utc', now()) + interval '5 minutes',
          jsonb_build_object(
            'resendPayload', jsonb_build_object(
              'to', jsonb_build_array(previous_current.selected_by_email),
              'subject', concat(request_row.player_name, ' availability updated'),
              'html', concat(
                '<p>',
                request_row.player_name,
                ' availability was updated for ',
                match_row.opponent,
                '. The answer changed from ',
                previous_current.status,
                ' to ',
                normalized_status,
                '. Updated by ',
                actor_name,
                '.</p>'
              )
            ),
            'displayName', 'Football Player',
            'teamName', '',
            'clubName', '',
            'playerName', request_row.player_name,
            'parentName', previous_current.selected_by_name,
            'clubId', request_row.club_id,
            'teamId', request_row.team_id,
            'actorId', '',
            'actorEmail', 'match-day-system',
            'actorRole', 'system',
            'requiredFeature', 'parentEmails',
            'matchDayAvailabilityChange', jsonb_build_object(
              'matchDayId', request_row.match_day_id,
              'playerId', request_row.player_id,
              'previousStatus', previous_current.status,
              'nextStatus', normalized_status,
              'updatedBy', actor_name
            )
          )
        )
        returning id
        into queued_notification_id;
      exception when others then
        warning_message := 'Availability change notification could not be queued.';
        queued_notification_id := null;
      end;
    end if;

    insert into public.match_day_player_availability_history (
      match_day_id,
      club_id,
      team_id,
      player_id,
      request_id,
      parent_link_id,
      player_name,
      previous_status,
      status,
      selected_by_name,
      selected_by_email,
      notification_queue_id,
      notification_warning
    )
    values (
      request_row.match_day_id,
      request_row.club_id,
      request_row.team_id,
      request_row.player_id,
      request_row.id,
      request_row.parent_link_id,
      request_row.player_name,
      previous_current.status,
      normalized_status,
      actor_name,
      actor_email,
      queued_notification_id,
      warning_message
    );
  end if;

  if coalesce(match_row.request_scorer, false)
    and updated_row.parent_link_id is not null
    and next_scorer_response in ('yes', 'no') then
    if link_row.id is null then
      select parent_link.*
      into link_row
      from public.parent_player_links as parent_link
      where parent_link.id = updated_row.parent_link_id
        and parent_link.status = 'active'
      limit 1;
    end if;

    if link_row.id is not null and next_scorer_response = 'yes' then
      insert into public.match_day_scorer_interest (
        match_day_id,
        club_id,
        team_id,
        parent_link_id,
        auth_user_id,
        parent_name,
        parent_email,
        message,
        status
      )
      values (
        match_row.id,
        match_row.club_id,
        match_row.team_id,
        link_row.id,
        link_row.auth_user_id,
        actor_name,
        updated_row.recipient_email,
        'Availability response volunteer',
        'interested'
      )
      on conflict (match_day_id, parent_link_id)
      do update
      set parent_name = excluded.parent_name,
          parent_email = excluded.parent_email,
          message = excluded.message,
          status = 'interested',
          updated_at = timezone('utc', now())
      where public.match_day_scorer_interest.status <> 'selected';
    elsif link_row.id is not null and next_scorer_response = 'no' then
      update public.match_day_scorer_interest as scorer_interest
      set status = 'declined',
          updated_at = timezone('utc', now())
      where scorer_interest.match_day_id = match_row.id
        and scorer_interest.parent_link_id = link_row.id
        and scorer_interest.status <> 'selected';
    end if;
  end if;

  request_id := updated_row.id;
  player_name := updated_row.player_name;
  response_status := updated_row.status;
  responded_at := updated_row.responded_at;
  volunteer_scorer_response := updated_row.volunteer_scorer_response;
  volunteer_linesman_response := updated_row.volunteer_linesman_response;
  volunteer_referee_response := updated_row.volunteer_referee_response;
  volunteer_responded_at := updated_row.volunteer_responded_at;
  return next;
end;
$$;

create or replace function public.confirm_match_day_availability(
  token_hash_value text,
  status_value text
)
returns table (
  request_id uuid,
  player_name text,
  response_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    response.request_id,
    response.player_name,
    response.response_status
  from public.submit_match_day_availability_response(
    token_hash_value,
    status_value,
    null,
    null,
    null
  ) as response;
end;
$$;

create or replace function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  arrival_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  request_scorer boolean,
  request_linesman boolean,
  request_referee boolean,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
  phase_started_at timestamptz,
  availability_status text,
  availability_responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  has_interest boolean,
  is_scorer boolean,
  events jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with parent_link as (
    select *
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = auth.uid()
      and status = 'active'
    limit 1
  )
  select
    match_day.id,
    match_day.club_id,
    match_day.team_id,
    coalesce(team.name, '') as team_name,
    match_day.opponent,
    match_day.match_date,
    match_day.kickoff_time,
    match_day.arrival_time,
    match_day.home_away,
    match_day.venue_name,
    match_day.venue_address,
    match_day.notes,
    match_day.scorer_request_message,
    match_day.request_scorer,
    match_day.request_linesman,
    match_day.request_referee,
    match_day.status,
    match_day.home_score,
    match_day.away_score,
    match_day.created_at,
    match_day.updated_at,
    match_day.phase_started_at,
    coalesce(current_availability.status, availability.status) as availability_status,
    coalesce(current_availability.selected_at, availability.responded_at) as availability_responded_at,
    coalesce(availability.volunteer_scorer_response, 'no_response') as volunteer_scorer_response,
    coalesce(availability.volunteer_linesman_response, 'no_response') as volunteer_linesman_response,
    coalesce(availability.volunteer_referee_response, 'no_response') as volunteer_referee_response,
    availability.volunteer_responded_at,
    exists (
      select 1
      from public.match_day_scorer_interest interest
      where interest.match_day_id = match_day.id
        and interest.parent_link_id = parent_link_id_value
        and interest.status <> 'declined'
    ) as has_interest,
    exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day.id
        and assignment.parent_link_id = parent_link_id_value
        and assignment.auth_user_id = auth.uid()
    ) as is_scorer,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', event.id,
            'eventType', event.event_type,
            'teamSide', event.team_side,
            'minute', event.minute,
            'scorerName', event.scorer_name,
            'scorerInitials', event.scorer_initials,
            'scorerShirtNumber', event.scorer_shirt_number,
            'assistName', event.assist_name,
            'assistInitials', event.assist_initials,
            'assistShirtNumber', event.assist_shirt_number,
            'homeScore', event.home_score,
            'awayScore', event.away_score,
            'notes', event.notes,
            'createdByName', event.created_by_name,
            'createdAt', event.created_at
          )
          order by event.created_at desc
        )
        from public.match_day_events event
        where event.match_day_id = match_day.id
      ),
      '[]'::jsonb
    ) as events
  from public.match_days match_day
  join parent_link link
    on link.club_id = match_day.club_id
  left join public.teams team
    on team.id = match_day.team_id
  left join public.match_day_player_availability current_availability
    on current_availability.match_day_id = match_day.id
    and current_availability.player_id = link.player_id
  left join lateral (
    select request.*
    from public.match_day_availability_requests request
    where request.match_day_id = match_day.id
      and request.club_id = link.club_id
      and request.player_id = link.player_id
      and request.status <> 'expired'
      and (
        request.parent_link_id = link.id
        or lower(request.recipient_email) = lower(coalesce(link.email, ''))
      )
    order by request.updated_at desc, request.created_at desc
    limit 1
  ) availability on true
  where auth.uid() is not null
    and match_day.parent_visible is true
    and match_day.parent_audience <> 'none'
    and match_day.status in ('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled')
    and match_day.previous_hidden_at is null
    and (
      (
        match_day.parent_audience = 'involved_players'
        and exists (
          select 1
          from public.match_day_availability_requests request
          where request.match_day_id = match_day.id
            and request.club_id = link.club_id
            and request.player_id = link.player_id
            and request.status <> 'expired'
        )
      )
      or (
        match_day.parent_audience = 'all_team_parents'
        and match_day.team_id is not null
        and match_day.team_id = link.team_id
      )
      or (
        match_day.parent_audience = 'all_club_parents'
        and match_day.club_id = link.club_id
      )
    )
    and (
      match_day.match_date is null
      or match_day.match_date >= (timezone('Europe/London', now())::date - 365)
    )
  order by match_day.match_date asc nulls last, match_day.kickoff_time asc nulls last, match_day.created_at desc;
$$;

revoke all on function public.get_match_day_availability_response_v2(text) from public;
revoke all on function public.submit_match_day_availability_response(text, text, text, text, text) from public;
revoke all on function public.confirm_match_day_availability(text, text) from public;
revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;

grant execute on function public.get_match_day_availability_response_v2(text) to anon;
grant execute on function public.get_match_day_availability_response_v2(text) to authenticated;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text) to anon;
grant execute on function public.submit_match_day_availability_response(text, text, text, text, text) to authenticated;
grant execute on function public.confirm_match_day_availability(text, text) to anon;
grant execute on function public.confirm_match_day_availability(text, text) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;

comment on table public.match_day_player_availability is
  'Current shared player availability answer for one Match Day fixture and player.';

comment on table public.match_day_player_availability_history is
  'Append-only history of parent-submitted shared player availability changes.';

comment on table public.match_day_role_assignments is
  'Selected parent volunteer for one Match Day fixture role.';

comment on function public.get_match_day_availability_response_v2(text) is
  'Reads a token-scoped Match Day response with current shared player availability.';

comment on function public.submit_match_day_availability_response(text, text, text, text, text) is
  'Stores a token-scoped Match Day response, shared player availability, and requested volunteer role responses.';
