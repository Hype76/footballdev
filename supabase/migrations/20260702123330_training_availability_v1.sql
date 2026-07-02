create table if not exists public.training_availability_settings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events(id) on delete cascade,
  enabled boolean not null default true,
  send_days_before integer not null default 2,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_availability_settings_days_check check (send_days_before between 0 and 30)
);

create unique index if not exists training_availability_settings_event_key
on public.training_availability_settings(calendar_event_id);

create index if not exists training_availability_settings_team_idx
on public.training_availability_settings(club_id, team_id, enabled);

create table if not exists public.training_availability_requests (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid not null,
  occurrence_date date not null,
  occurrence_starts_at timestamptz not null,
  occurrence_ends_at timestamptz,
  send_at timestamptz not null,
  status text not null default 'pending',
  locked_at timestamptz,
  generated_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_availability_requests_status_check check (status in ('pending', 'queued', 'sending', 'sent', 'partial_failed', 'cancelled'))
);

create unique index if not exists training_availability_requests_event_occurrence_key
on public.training_availability_requests(calendar_event_id, occurrence_date);

create index if not exists training_availability_requests_due_idx
on public.training_availability_requests(status, send_at);

create index if not exists training_availability_requests_team_idx
on public.training_availability_requests(club_id, team_id, occurrence_date);

create table if not exists public.training_availability_request_players (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.training_availability_requests(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid not null,
  player_id uuid not null references public.players(id) on delete cascade,
  player_name text not null default '',
  parent_link_id uuid references public.parent_player_links(id) on delete set null,
  recipient_email text not null,
  recipient_name text not null default '',
  recipient_type text not null default 'parent',
  token_hash text not null,
  status text not null default 'pending',
  email_sent_at timestamptz,
  responded_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_availability_request_players_status_check check (status in ('pending', 'queued', 'sent', 'failed', 'responded', 'cancelled', 'expired')),
  constraint training_availability_request_players_email_check check (recipient_email <> ''),
  constraint training_availability_request_players_token_check check (token_hash ~ '^[a-f0-9]{64}$')
);

create unique index if not exists training_availability_request_players_recipient_key
on public.training_availability_request_players(request_id, player_id, lower(recipient_email));

create unique index if not exists training_availability_request_players_token_key
on public.training_availability_request_players(token_hash);

create index if not exists training_availability_request_players_player_idx
on public.training_availability_request_players(club_id, team_id, player_id);

create table if not exists public.training_availability_responses (
  id uuid primary key default gen_random_uuid(),
  request_player_id uuid not null references public.training_availability_request_players(id) on delete cascade,
  request_id uuid not null references public.training_availability_requests(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  parent_link_id uuid references public.parent_player_links(id) on delete set null,
  status text not null,
  note text not null default '',
  responded_by_name text not null default '',
  responded_by_email text not null default '',
  responded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_availability_responses_status_check check (status in ('available', 'unavailable', 'maybe'))
);

create unique index if not exists training_availability_responses_request_player_key
on public.training_availability_responses(request_id, player_id);

create index if not exists training_availability_responses_team_idx
on public.training_availability_responses(club_id, team_id, calendar_event_id, responded_at desc);

create or replace function public.set_training_availability_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_training_availability_settings_updated_at on public.training_availability_settings;
create trigger set_training_availability_settings_updated_at
before update on public.training_availability_settings
for each row execute function public.set_training_availability_updated_at();

drop trigger if exists set_training_availability_requests_updated_at on public.training_availability_requests;
create trigger set_training_availability_requests_updated_at
before update on public.training_availability_requests
for each row execute function public.set_training_availability_updated_at();

drop trigger if exists set_training_availability_request_players_updated_at on public.training_availability_request_players;
create trigger set_training_availability_request_players_updated_at
before update on public.training_availability_request_players
for each row execute function public.set_training_availability_updated_at();

drop trigger if exists set_training_availability_responses_updated_at on public.training_availability_responses;
create trigger set_training_availability_responses_updated_at
before update on public.training_availability_responses
for each row execute function public.set_training_availability_updated_at();

alter table public.training_availability_settings enable row level security;
alter table public.training_availability_settings force row level security;
alter table public.training_availability_requests enable row level security;
alter table public.training_availability_requests force row level security;
alter table public.training_availability_request_players enable row level security;
alter table public.training_availability_request_players force row level security;
alter table public.training_availability_responses enable row level security;
alter table public.training_availability_responses force row level security;

revoke all on public.training_availability_settings from public;
revoke all on public.training_availability_settings from anon;
revoke all on public.training_availability_settings from authenticated;
revoke all on public.training_availability_requests from public;
revoke all on public.training_availability_requests from anon;
revoke all on public.training_availability_requests from authenticated;
revoke all on public.training_availability_request_players from public;
revoke all on public.training_availability_request_players from anon;
revoke all on public.training_availability_request_players from authenticated;
revoke all on public.training_availability_responses from public;
revoke all on public.training_availability_responses from anon;
revoke all on public.training_availability_responses from authenticated;

grant select, insert, update, delete on public.training_availability_settings to authenticated;
grant select, update on public.training_availability_requests to authenticated;
grant select on public.training_availability_request_players to authenticated;
grant select on public.training_availability_responses to authenticated;

create or replace function public.training_availability_user_can_view(target_club_id uuid, target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and target_team_id is not null
    and public.current_user_club_id() = target_club_id
    and public.current_user_role() not in ('parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 20
    and exists (
      select 1
      from public.teams team
      where team.id = target_team_id
        and team.club_id = target_club_id
    )
    and (
      public.current_user_role_rank() >= 50
      or exists (
        select 1
        from public.team_staff staff
        where staff.team_id = target_team_id
          and staff.user_id = auth.uid()
      )
    );
$$;

create or replace function public.training_availability_user_can_manage(target_club_id uuid, target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.training_availability_user_can_view(target_club_id, target_team_id);
$$;

create or replace function public.training_availability_calendar_event_in_scope(
  target_calendar_event_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null
    and exists (
      select 1
      from public.calendar_events event
      where event.id = target_calendar_event_id
        and event.club_id = target_club_id
        and event.team_id = target_team_id
        and event.event_type = 'training'
        and event.cancelled_at is null
    );
$$;

create or replace function public.training_availability_player_in_scope(
  target_player_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null
    and exists (
      select 1
      from public.players player
      where player.id = target_player_id
        and player.club_id = target_club_id
        and player.team_id = target_team_id
        and coalesce(player.status, 'active') <> 'archived'
    );
$$;

drop policy if exists training_availability_settings_select_staff on public.training_availability_settings;
create policy training_availability_settings_select_staff
on public.training_availability_settings
for select
to authenticated
using (
  public.training_availability_user_can_view(club_id, team_id)
);

drop policy if exists training_availability_settings_insert_manager on public.training_availability_settings;
create policy training_availability_settings_insert_manager
on public.training_availability_settings
for insert
to authenticated
with check (
  public.training_availability_user_can_manage(club_id, team_id)
  and public.training_availability_calendar_event_in_scope(calendar_event_id, club_id, team_id)
);

drop policy if exists training_availability_settings_update_manager on public.training_availability_settings;
create policy training_availability_settings_update_manager
on public.training_availability_settings
for update
to authenticated
using (
  public.training_availability_user_can_manage(club_id, team_id)
)
with check (
  public.training_availability_user_can_manage(club_id, team_id)
  and public.training_availability_calendar_event_in_scope(calendar_event_id, club_id, team_id)
);

drop policy if exists training_availability_settings_delete_manager on public.training_availability_settings;
create policy training_availability_settings_delete_manager
on public.training_availability_settings
for delete
to authenticated
using (
  public.training_availability_user_can_manage(club_id, team_id)
);

drop policy if exists training_availability_requests_select_staff on public.training_availability_requests;
create policy training_availability_requests_select_staff
on public.training_availability_requests
for select
to authenticated
using (
  public.training_availability_user_can_view(club_id, team_id)
);

drop policy if exists training_availability_requests_cancel_manager on public.training_availability_requests;
create policy training_availability_requests_cancel_manager
on public.training_availability_requests
for update
to authenticated
using (
  public.training_availability_user_can_manage(club_id, team_id)
  and status in ('pending', 'queued')
)
with check (
  public.training_availability_user_can_manage(club_id, team_id)
  and status = 'cancelled'
);

drop policy if exists training_availability_request_players_select_staff on public.training_availability_request_players;
create policy training_availability_request_players_select_staff
on public.training_availability_request_players
for select
to authenticated
using (
  public.training_availability_user_can_view(club_id, team_id)
);

drop policy if exists training_availability_responses_select_staff on public.training_availability_responses;
create policy training_availability_responses_select_staff
on public.training_availability_responses
for select
to authenticated
using (
  public.training_availability_user_can_view(club_id, team_id)
);

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
set search_path = public
as $$
declare
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  request_player_row public.training_availability_request_players%rowtype;
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
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

  if request_player_row.status = 'cancelled' then
    return;
  end if;

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
  left join public.teams team
    on team.id = request.team_id
  left join public.training_availability_responses response
    on response.request_player_id = request_player_row.id
  where request.id = request_player_row.request_id
    and request.status <> 'cancelled'
    and event.cancelled_at is null;
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
set search_path = public
as $$
#variable_conflict use_column
declare
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  normalized_status text := lower(trim(coalesce(status_value, '')));
  normalized_note text := left(trim(coalesce(note_value, '')), 1000);
  request_player_row public.training_availability_request_players%rowtype;
  link_row public.parent_player_links%rowtype;
  response_row public.training_availability_responses%rowtype;
  actor_name text := '';
  actor_email text := '';
begin
  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  if normalized_status not in ('available', 'unavailable', 'maybe') then
    return;
  end if;

  select request_player.*
  into request_player_row
  from public.training_availability_request_players request_player
  where request_player.token_hash = normalized_token_hash
  limit 1;

  if request_player_row.id is null or request_player_row.status = 'cancelled' then
    return;
  end if;

  if request_player_row.parent_link_id is not null then
    select parent_link.*
    into link_row
    from public.parent_player_links parent_link
    where parent_link.id = request_player_row.parent_link_id
      and parent_link.club_id = request_player_row.club_id
      and parent_link.team_id = request_player_row.team_id
      and parent_link.player_id = request_player_row.player_id
      and parent_link.status = 'active'
    limit 1;

    if link_row.id is null then
      return;
    end if;
  end if;

  actor_email := coalesce(nullif(request_player_row.recipient_email, ''), link_row.email, '');
  actor_name := coalesce(nullif(request_player_row.recipient_name, ''), nullif(actor_email, ''), 'Parent');

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
  where request_player.id = request_player_row.id;

  request_player_id := response_row.request_player_id;
  request_id := response_row.request_id;
  player_name := request_player_row.player_name;
  response_status := response_row.status;
  response_note := response_row.note;
  responded_at := response_row.responded_at;
  return next;
end;
$$;

revoke all on function public.set_training_availability_updated_at() from public;
revoke all on function public.training_availability_user_can_view(uuid, uuid) from public;
revoke all on function public.training_availability_user_can_manage(uuid, uuid) from public;
revoke all on function public.training_availability_calendar_event_in_scope(uuid, uuid, uuid) from public;
revoke all on function public.training_availability_player_in_scope(uuid, uuid, uuid) from public;
revoke all on function public.get_training_availability_response(text) from public;
revoke all on function public.submit_training_availability_response(text, text, text) from public;

revoke execute on function public.training_availability_user_can_view(uuid, uuid) from anon;
revoke execute on function public.training_availability_user_can_manage(uuid, uuid) from anon;
revoke execute on function public.training_availability_calendar_event_in_scope(uuid, uuid, uuid) from anon;
revoke execute on function public.training_availability_player_in_scope(uuid, uuid, uuid) from anon;

grant execute on function public.training_availability_user_can_view(uuid, uuid) to authenticated, service_role;
grant execute on function public.training_availability_user_can_manage(uuid, uuid) to authenticated, service_role;
grant execute on function public.training_availability_calendar_event_in_scope(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.training_availability_player_in_scope(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.get_training_availability_response(text) to anon, authenticated;
grant execute on function public.submit_training_availability_response(text, text, text) to anon, authenticated;

comment on table public.training_availability_settings is
  'Team-scoped V1 settings for asking parents about player availability for training calendar events.';

comment on table public.training_availability_requests is
  'One Training Availability request per training calendar event occurrence.';

comment on table public.training_availability_request_players is
  'Idempotent per-player parent email recipient rows for one Training Availability occurrence.';

comment on table public.training_availability_responses is
  'Parent responses for a player on one Training Availability occurrence.';
