alter table public.match_day_player_availability_history
  add column if not exists source text,
  add column if not exists actor_user_id uuid;

update public.match_day_player_availability_history history
set source = case
  when history.request_id is null then 'staff_on_behalf'
  when exists (
    select 1
    from public.match_day_availability_requests request
    where request.id = history.request_id
      and request.recipient_type = 'player'
  ) then 'adult_player'
  else 'parent'
end
where history.source is null;

alter table public.match_day_player_availability_history
  alter column source set default 'parent',
  alter column source set not null;

alter table public.match_day_player_availability_history
  drop constraint if exists match_day_player_availability_history_source_check;

alter table public.match_day_player_availability_history
  add constraint match_day_player_availability_history_source_check
  check (source in ('parent', 'adult_player', 'staff_on_behalf'));

create or replace function public.set_match_day_availability_history_context_12c()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_recipient_type text := '';
begin
  if new.request_id is not null then
    select coalesce(request.recipient_type, '')
    into request_recipient_type
    from public.match_day_availability_requests request
    where request.id = new.request_id
    limit 1;
  end if;

  new.actor_user_id := coalesce(new.actor_user_id, auth.uid());
  new.source := case
    when new.request_id is null then 'staff_on_behalf'
    when request_recipient_type = 'player' then 'adult_player'
    else 'parent'
  end;

  return new;
end;
$$;

revoke all on function public.set_match_day_availability_history_context_12c()
from public, anon, authenticated;

drop trigger if exists set_match_day_availability_history_context_12c
on public.match_day_player_availability_history;

create trigger set_match_day_availability_history_context_12c
before insert on public.match_day_player_availability_history
for each row
execute function public.set_match_day_availability_history_context_12c();

alter function public.submit_match_day_availability_response(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer
)
rename to submit_match_day_availability_response_12c_legacy;

revoke all on function public.submit_match_day_availability_response_12c_legacy(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer
)
from public, anon, authenticated;

grant execute on function public.submit_match_day_availability_response_12c_legacy(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer
)
to service_role;

create function public.submit_match_day_availability_response(
  token_hash_value text,
  status_value text,
  volunteer_scorer_response_value text default null,
  volunteer_linesman_response_value text default null,
  volunteer_referee_response_value text default null,
  transport_needs_lift_value boolean default null,
  transport_can_offer_lift_value boolean default null,
  transport_seats_offered_value integer default null
)
returns table (
  request_id uuid,
  player_name text,
  response_status text,
  responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  transport_needs_lift boolean,
  transport_can_offer_lift boolean,
  transport_seats_offered integer,
  transport_responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  request_key record;
begin
  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request.match_day_id, request.player_id
  into request_key
  from public.match_day_availability_requests request
  where request.token_hash = normalized_token_hash
  limit 1;

  if request_key.match_day_id is null or request_key.player_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat(
        'shared_child_rsvp:match:',
        request_key.match_day_id::text,
        ':',
        request_key.player_id::text
      ),
      0
    )
  );

  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  return query
  select *
  from public.submit_match_day_availability_response_12c_legacy(
    normalized_token_hash,
    status_value,
    volunteer_scorer_response_value,
    volunteer_linesman_response_value,
    volunteer_referee_response_value,
    transport_needs_lift_value,
    transport_can_offer_lift_value,
    transport_seats_offered_value
  );
end;
$$;

revoke all on function public.submit_match_day_availability_response(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer
)
from public;

grant execute on function public.submit_match_day_availability_response(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer
)
to anon, authenticated, service_role;

alter table public.training_availability_responses
  add column if not exists response_source text,
  add column if not exists responded_by_user_id uuid;

update public.training_availability_responses response
set response_source = case
  when response.parent_link_id is not null then 'parent'
  when exists (
    select 1
    from public.training_availability_request_players request_player
    where request_player.id = response.request_player_id
      and request_player.recipient_type = 'player'
  ) then 'adult_player'
  else 'parent'
end
where response.response_source is null;

alter table public.training_availability_responses
  alter column response_source set default 'parent',
  alter column response_source set not null;

alter table public.training_availability_responses
  drop constraint if exists training_availability_responses_source_check;

alter table public.training_availability_responses
  add constraint training_availability_responses_source_check
  check (response_source in ('parent', 'adult_player', 'staff_on_behalf'));

create table if not exists public.training_availability_response_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.training_availability_requests(id) on delete cascade,
  request_player_id uuid references public.training_availability_request_players(id) on delete set null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events(id) on delete cascade,
  occurrence_date date not null,
  player_id uuid not null references public.players(id) on delete cascade,
  parent_link_id uuid references public.parent_player_links(id) on delete set null,
  previous_status text not null,
  status text not null,
  previous_note text not null default '',
  note text not null default '',
  actor_name text not null default '',
  actor_email text not null default '',
  actor_user_id uuid,
  source text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint training_availability_response_history_previous_status_check
    check (previous_status in ('pending', 'available', 'unavailable', 'maybe')),
  constraint training_availability_response_history_status_check
    check (status in ('available', 'unavailable', 'maybe')),
  constraint training_availability_response_history_source_check
    check (source in ('parent', 'adult_player', 'staff_on_behalf'))
);

create index if not exists training_availability_response_history_request_player_idx
on public.training_availability_response_history (request_id, player_id, created_at desc);

create index if not exists training_availability_response_history_event_occurrence_idx
on public.training_availability_response_history (
  calendar_event_id,
  occurrence_date,
  player_id,
  created_at desc
);

alter table public.training_availability_response_history enable row level security;
alter table public.training_availability_response_history force row level security;

revoke all on public.training_availability_response_history from public, anon, authenticated;
grant select on public.training_availability_response_history to authenticated;
grant select, insert, update, delete on public.training_availability_response_history to service_role;

drop policy if exists training_availability_response_history_staff_select_exact_team
on public.training_availability_response_history;

create policy training_availability_response_history_staff_select_exact_team
on public.training_availability_response_history
for select
to authenticated
using (
  public.current_user_can_access_team(club_id, team_id)
);

create or replace function public.set_training_availability_response_context_12c()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_recipient_type text := '';
  actor_is_staff boolean := false;
begin
  select coalesce(request_player.recipient_type, '')
  into request_recipient_type
  from public.training_availability_request_players request_player
  where request_player.id = new.request_player_id
  limit 1;

  if auth.uid() is not null then
    select exists (
      select 1
      from public.users profile
      where profile.id = auth.uid()
        and coalesce(profile.status, 'active') = 'active'
        and profile.role <> 'parent_portal'
        and coalesce(profile.role_rank, 0) >= 20
    )
    into actor_is_staff;
  end if;

  new.responded_by_user_id := auth.uid();
  new.response_source := case
    when new.parent_link_id is not null then 'parent'
    when actor_is_staff then 'staff_on_behalf'
    when request_recipient_type = 'player' then 'adult_player'
    else 'parent'
  end;

  return new;
end;
$$;

revoke all on function public.set_training_availability_response_context_12c()
from public, anon, authenticated;

drop trigger if exists set_training_availability_response_context_12c
on public.training_availability_responses;

create trigger set_training_availability_response_context_12c
before insert or update on public.training_availability_responses
for each row
execute function public.set_training_availability_response_context_12c();

create or replace function public.record_training_availability_response_history_12c()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  response_occurrence_date date;
begin
  select request.occurrence_date
  into response_occurrence_date
  from public.training_availability_requests request
  where request.id = new.request_id
  limit 1;

  insert into public.training_availability_response_history (
    request_id,
    request_player_id,
    club_id,
    team_id,
    calendar_event_id,
    occurrence_date,
    player_id,
    parent_link_id,
    previous_status,
    status,
    previous_note,
    note,
    actor_name,
    actor_email,
    actor_user_id,
    source,
    created_at
  )
  values (
    new.request_id,
    new.request_player_id,
    new.club_id,
    new.team_id,
    new.calendar_event_id,
    response_occurrence_date,
    new.player_id,
    new.parent_link_id,
    case when tg_op = 'UPDATE' then old.status else 'pending' end,
    new.status,
    case when tg_op = 'UPDATE' then coalesce(old.note, '') else '' end,
    coalesce(new.note, ''),
    coalesce(new.responded_by_name, ''),
    coalesce(new.responded_by_email, ''),
    new.responded_by_user_id,
    new.response_source,
    coalesce(new.responded_at, timezone('utc', now()))
  );

  return new;
end;
$$;

revoke all on function public.record_training_availability_response_history_12c()
from public, anon, authenticated;

drop trigger if exists record_training_availability_response_history_12c
on public.training_availability_responses;

create trigger record_training_availability_response_history_12c
after insert or update on public.training_availability_responses
for each row
execute function public.record_training_availability_response_history_12c();

create or replace function public.get_training_availability_response(token_hash_value text)
returns table (
  request_player_id uuid,
  request_id uuid,
  calendar_event_id uuid,
  player_id uuid,
  player_name text,
  recipient_name text,
  recipient_email text,
  response_status text,
  response_note text,
  responded_at timestamptz,
  team_name text,
  event_title text,
  occurrence_date date,
  occurrence_starts_at timestamptz,
  occurrence_ends_at timestamptz,
  location text,
  notes text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  request_player_row public.training_availability_request_players%rowtype;
begin
  if not public.is_training_availability_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  limit 1;

  return query
  select
    request_player_row.id,
    request_player_row.request_id,
    request_player_row.calendar_event_id,
    request_player_row.player_id,
    request_player_row.player_name,
    request_player_row.recipient_name,
    request_player_row.recipient_email,
    response.status,
    coalesce(response.note, ''),
    response.responded_at,
    coalesce(team.name, '') as team_name,
    event.title,
    request.occurrence_date,
    request.occurrence_starts_at,
    request.occurrence_ends_at,
    event.location,
    event.notes
  from public.training_availability_requests request
  join public.calendar_events event
    on event.id = request.calendar_event_id
    and event.club_id = request.club_id
    and event.team_id = request.team_id
  left join public.teams team
    on team.id = request.team_id
    and team.club_id = request.club_id
  left join public.training_availability_responses response
    on response.request_id = request_player_row.request_id
    and response.player_id = request_player_row.player_id
    and response.club_id = request_player_row.club_id
    and response.team_id = request_player_row.team_id
    and response.calendar_event_id = request_player_row.calendar_event_id
  where request.id = request_player_row.request_id
    and request.club_id = request_player_row.club_id
    and request.team_id = request_player_row.team_id
    and request.calendar_event_id = request_player_row.calendar_event_id;
end;
$$;

create or replace function public.submit_training_availability_response(
  token_hash_value text,
  status_value text,
  note_value text default ''
)
returns table (
  request_player_id uuid,
  request_id uuid,
  player_name text,
  response_status text,
  response_note text,
  responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  normalized_note text := left(btrim(coalesce(note_value, '')), 1000);
  request_player_row public.training_availability_request_players%rowtype;
  response_row public.training_availability_responses%rowtype;
  actor_name text := '';
  actor_email text := '';
begin
  if normalized_status not in ('available', 'unavailable', 'maybe') then
    return;
  end if;

  if not public.is_training_availability_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  limit 1;

  if request_player_row.id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat(
        'shared_child_rsvp:training:',
        request_player_row.request_id::text,
        ':',
        request_player_row.player_id::text
      ),
      0
    )
  );

  if not public.is_training_availability_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  for update;

  actor_email := coalesce(request_player_row.recipient_email, '');
  actor_name := coalesce(
    nullif(request_player_row.recipient_name, ''),
    nullif(actor_email, ''),
    'Parent'
  );

  insert into public.training_availability_responses (
    request_player_id,
    request_id,
    club_id,
    team_id,
    calendar_event_id,
    player_id,
    parent_link_id,
    status,
    note,
    responded_by_name,
    responded_by_email,
    responded_at
  )
  values (
    request_player_row.id,
    request_player_row.request_id,
    request_player_row.club_id,
    request_player_row.team_id,
    request_player_row.calendar_event_id,
    request_player_row.player_id,
    request_player_row.parent_link_id,
    normalized_status,
    normalized_note,
    actor_name,
    actor_email,
    timezone('utc', now())
  )
  on conflict (request_id, player_id)
  do update
  set request_player_id = excluded.request_player_id,
      parent_link_id = excluded.parent_link_id,
      status = excluded.status,
      note = excluded.note,
      responded_by_name = excluded.responded_by_name,
      responded_by_email = excluded.responded_by_email,
      responded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  returning *
  into response_row;

  update public.training_availability_request_players request_player
  set status = 'responded',
      responded_at = response_row.responded_at,
      updated_at = timezone('utc', now())
  where request_player.request_id = request_player_row.request_id
    and request_player.player_id = request_player_row.player_id
    and request_player.club_id = request_player_row.club_id
    and request_player.team_id = request_player_row.team_id
    and request_player.calendar_event_id = request_player_row.calendar_event_id
    and request_player.status not in ('cancelled', 'expired');

  request_player_id := request_player_row.id;
  request_id := response_row.request_id;
  player_name := request_player_row.player_name;
  response_status := response_row.status;
  response_note := response_row.note;
  responded_at := response_row.responded_at;
  return next;
end;
$$;

revoke all on function public.get_training_availability_response(text) from public;
revoke all on function public.submit_training_availability_response(text, text, text) from public;
grant execute on function public.get_training_availability_response(text) to anon, authenticated;
grant execute on function public.submit_training_availability_response(text, text, text) to anon, authenticated;

comment on table public.training_availability_response_history is
  'Append-only audit history for one shared Training response per occurrence and player.';

comment on column public.training_availability_responses.response_source is
  'The source of the latest authoritative response: parent, adult_player, or staff_on_behalf.';

comment on function public.get_training_availability_response(text) is
  'Returns the shared current Training response for the token occurrence and player, regardless of which eligible linked parent responded.';

comment on function public.submit_training_availability_response(text, text, text) is
  'Serializes Training updates by occurrence and player, preserves every audit change, and marks all active recipient rows for the player as responded.';

comment on function public.submit_match_day_availability_response(
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  integer
) is
  'Serializes Match Day response updates by fixture and player before delegating to the approved shared response and auto-selection behavior.';
