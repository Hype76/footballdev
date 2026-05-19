create table if not exists public.match_locations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  address text not null default '',
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists match_locations_club_name_address_key
on public.match_locations (club_id, lower(name), lower(address));

create table if not exists public.match_days (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  location_id uuid references public.match_locations (id) on delete set null,
  opponent text not null,
  match_date date,
  kickoff_time time,
  home_away text not null default 'home',
  venue_name text not null default '',
  venue_address text not null default '',
  notes text not null default '',
  scorer_request_message text not null default '',
  status text not null default 'scheduled',
  home_score integer not null default 0,
  away_score integer not null default 0,
  previous_hidden_at timestamptz,
  previous_hidden_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_days_home_away_check check (home_away in ('home', 'away', 'neutral')),
  constraint match_days_status_check check (status in ('scheduled', 'scorer_request', 'live', 'half_time', 'full_time', 'postponed', 'cancelled')),
  constraint match_days_score_check check (home_score >= 0 and away_score >= 0)
);

create index if not exists match_days_club_team_status_idx
on public.match_days (club_id, team_id, status, match_date);

create table if not exists public.match_day_scorer_interest (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  auth_user_id uuid references auth.users (id) on delete cascade,
  parent_name text not null default '',
  parent_email text not null default '',
  message text not null default '',
  status text not null default 'interested',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_scorer_interest_status_check check (status in ('interested', 'selected', 'declined'))
);

create unique index if not exists match_day_scorer_interest_match_parent_key
on public.match_day_scorer_interest (match_day_id, parent_link_id);

create table if not exists public.match_day_scorer_assignments (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  auth_user_id uuid references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_by_name text,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists match_day_scorer_assignments_match_parent_key
on public.match_day_scorer_assignments (match_day_id, parent_link_id);

create table if not exists public.match_day_events (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  event_type text not null default 'goal',
  team_side text not null default 'club',
  minute integer,
  scorer_name text not null default '',
  scorer_initials text not null default '',
  scorer_shirt_number text not null default '',
  assist_name text not null default '',
  assist_initials text not null default '',
  assist_shirt_number text not null default '',
  home_score integer not null default 0,
  away_score integer not null default 0,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_by_parent_link_id uuid references public.parent_player_links (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint match_day_events_type_check check (event_type in ('goal', 'score_correction', 'status_change', 'note')),
  constraint match_day_events_team_side_check check (team_side in ('club', 'opponent')),
  constraint match_day_events_score_check check (home_score >= 0 and away_score >= 0),
  constraint match_day_events_minute_check check (minute is null or (minute >= 0 and minute <= 130))
);

create index if not exists match_day_events_match_created_idx
on public.match_day_events (match_day_id, created_at desc);

alter table public.match_locations enable row level security;
alter table public.match_days enable row level security;
alter table public.match_day_scorer_interest enable row level security;
alter table public.match_day_scorer_assignments enable row level security;
alter table public.match_day_events enable row level security;

grant select, insert, update, delete on public.match_locations to authenticated;
grant select, insert, update, delete on public.match_days to authenticated;
grant select, insert, update, delete on public.match_day_scorer_interest to authenticated;
grant select, insert, update, delete on public.match_day_scorer_assignments to authenticated;
grant select, insert, update, delete on public.match_day_events to authenticated;

create or replace function public.can_manage_match_day(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'super_admin'
    or (
      public.current_user_role() <> 'parent_portal'
      and public.current_user_club_id() is not null
      and public.current_user_role_rank() >= 20
      and (
        target_team_id is null
        or public.current_user_role_rank() >= 50
        or exists (
          select 1
          from public.team_staff ts
          where ts.team_id = target_team_id
            and ts.user_id = auth.uid()
        )
      )
    );
$$;

grant execute on function public.can_manage_match_day(uuid) to authenticated;

create or replace function public.current_user_is_match_day_scorer(target_match_day_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.match_day_scorer_assignments assignment
    where assignment.match_day_id = target_match_day_id
      and assignment.auth_user_id = auth.uid()
  );
$$;

grant execute on function public.current_user_is_match_day_scorer(uuid) to authenticated;

drop policy if exists match_locations_staff_scoped on public.match_locations;
create policy match_locations_staff_scoped
on public.match_locations
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
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_days_staff_select_scoped on public.match_days;
create policy match_days_staff_select_scoped
on public.match_days
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_days_staff_insert_scoped on public.match_days;
create policy match_days_staff_insert_scoped
on public.match_days
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_days_staff_update_scoped on public.match_days;
create policy match_days_staff_update_scoped
on public.match_days
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
)
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_days_staff_delete_scoped on public.match_days;
create policy match_days_staff_delete_scoped
on public.match_days
for delete
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
  and public.current_user_role_rank() >= 50
);

drop policy if exists match_day_interest_staff_select_scoped on public.match_day_scorer_interest;
create policy match_day_interest_staff_select_scoped
on public.match_day_scorer_interest
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_day_interest_staff_update_scoped on public.match_day_scorer_interest;
create policy match_day_interest_staff_update_scoped
on public.match_day_scorer_interest
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
)
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_day_assignments_staff_scoped on public.match_day_scorer_assignments;
create policy match_day_assignments_staff_scoped
on public.match_day_scorer_assignments
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
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_day_events_staff_select_scoped on public.match_day_events;
create policy match_day_events_staff_select_scoped
on public.match_day_events
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_day_events_staff_insert_scoped on public.match_day_events;
create policy match_day_events_staff_insert_scoped
on public.match_day_events
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and (
    public.can_manage_match_day(team_id)
    or public.current_user_is_match_day_scorer(match_day_id)
  )
);

create or replace function public.get_initials_from_full_name(full_name_value text)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select string_agg(upper(left(part, 1)), '')
      from regexp_split_to_table(trim(coalesce(full_name_value, '')), '[^A-Za-z0-9]+') part
      where part <> ''
    ),
    ''
  );
$$;

grant execute on function public.get_initials_from_full_name(text) to authenticated;

create or replace function public.upsert_match_location(
  club_id_value uuid,
  name_value text,
  address_value text,
  notes_value text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  location_id_value uuid;
  normalized_name text := trim(coalesce(name_value, ''));
  normalized_address text := trim(coalesce(address_value, ''));
begin
  if normalized_name = '' then
    return null;
  end if;

  insert into public.match_locations (club_id, name, address, notes, created_by)
  values (club_id_value, normalized_name, normalized_address, trim(coalesce(notes_value, '')), auth.uid())
  on conflict (club_id, (lower(name)), (lower(address)))
  do update set
    notes = coalesce(nullif(excluded.notes, ''), public.match_locations.notes),
    updated_at = timezone('utc', now())
  returning id into location_id_value;

  return location_id_value;
end;
$$;

grant execute on function public.upsert_match_location(uuid, text, text, text) to authenticated;

create or replace function public.get_parent_portal_match_days(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  team_name text,
  opponent text,
  match_date date,
  kickoff_time time,
  home_away text,
  venue_name text,
  venue_address text,
  notes text,
  scorer_request_message text,
  status text,
  home_score integer,
  away_score integer,
  created_at timestamptz,
  updated_at timestamptz,
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
    match_day.home_away,
    match_day.venue_name,
    match_day.venue_address,
    match_day.notes,
    match_day.scorer_request_message,
    match_day.status,
    match_day.home_score,
    match_day.away_score,
    match_day.created_at,
    match_day.updated_at,
    exists (
      select 1
      from public.match_day_scorer_interest interest
      where interest.match_day_id = match_day.id
        and interest.parent_link_id = parent_link_id_value
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
    and (match_day.team_id is null or match_day.team_id = link.team_id)
  left join public.teams team
    on team.id = match_day.team_id
  where auth.uid() is not null
    and match_day.status in ('scorer_request', 'live', 'half_time', 'full_time', 'scheduled')
    and match_day.previous_hidden_at is null
    and (
      match_day.match_date is null
      or match_day.match_date >= (timezone('Europe/London', now())::date - 365)
    )
  order by match_day.match_date asc nulls last, match_day.kickoff_time asc nulls last, match_day.created_at desc;
$$;

grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;

create or replace function public.express_match_day_scorer_interest(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  message_value text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  interest_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Login is required before volunteering.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and status in ('scheduled', 'scorer_request', 'live')
    and (team_id is null or team_id = link_row.team_id)
  limit 1;

  if match_row.id is null then
    raise exception 'This Match Day request is no longer available.';
  end if;

  insert into public.match_day_scorer_interest (
    match_day_id,
    club_id,
    team_id,
    parent_link_id,
    auth_user_id,
    parent_name,
    parent_email,
    message
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    link_row.id,
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, ''),
    lower(coalesce(nullif(link_row.email, ''), auth.jwt() ->> 'email', auth.uid()::text)),
    trim(coalesce(message_value, ''))
  )
  on conflict (match_day_id, parent_link_id)
  do update set
    message = excluded.message,
    status = 'interested',
    auth_user_id = excluded.auth_user_id,
    parent_email = excluded.parent_email,
    updated_at = timezone('utc', now())
  returning id into interest_id_value;

  return interest_id_value;
end;
$$;

grant execute on function public.express_match_day_scorer_interest(uuid, uuid, text) to authenticated;

create or replace function public.update_match_day_score_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  home_score_value integer,
  away_score_value integer,
  status_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  event_id_value uuid;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Login is required before updating the score.';
  end if;

  if home_score_value < 0 or away_score_value < 0 then
    raise exception 'Scores cannot be below zero.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day_id_value
        and assignment.parent_link_id = link_row.id
        and assignment.auth_user_id = auth.uid()
    )
  limit 1;

  if match_row.id is null then
    raise exception 'Only selected scorers can update this match.';
  end if;

  next_status := coalesce(nullif(status_value, ''), match_row.status);

  if next_status not in ('scheduled', 'scorer_request', 'live', 'half_time', 'full_time', 'postponed', 'cancelled') then
    raise exception 'Choose a valid match status.';
  end if;

  update public.match_days
  set
    home_score = home_score_value,
    away_score = away_score_value,
    status = next_status,
    updated_at = timezone('utc', now())
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id,
    club_id,
    team_id,
    event_type,
    team_side,
    home_score,
    away_score,
    created_by,
    created_by_parent_link_id,
    created_by_name,
    notes
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'score_correction',
    'club',
    home_score_value,
    away_score_value,
    auth.uid(),
    link_row.id,
    coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, ''),
    'Score updated'
  )
  returning id into event_id_value;

  return event_id_value;
end;
$$;

grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to authenticated;

create or replace function public.add_match_day_goal_as_scorer(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  team_side_value text,
  scorer_name_value text,
  scorer_shirt_number_value text default '',
  assist_name_value text default '',
  assist_shirt_number_value text default '',
  minute_value integer default null,
  notes_value text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  event_id_value uuid;
  next_home_score integer;
  next_away_score integer;
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
begin
  if auth.uid() is null then
    raise exception 'Login is required before adding a goal.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose who scored the goal.';
  end if;

  if minute_value is not null and (minute_value < 0 or minute_value > 130) then
    raise exception 'Minute must be between 0 and 130.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
    and club_id = link_row.club_id
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      where assignment.match_day_id = match_day_id_value
        and assignment.parent_link_id = link_row.id
        and assignment.auth_user_id = auth.uid()
    )
  limit 1;

  if match_row.id is null then
    raise exception 'Only selected scorers can update this match.';
  end if;

  next_home_score := match_row.home_score;
  next_away_score := match_row.away_score;

  if normalized_team_side = 'club' then
    if match_row.home_away = 'away' then
      next_away_score := next_away_score + 1;
    else
      next_home_score := next_home_score + 1;
    end if;
  else
    if match_row.home_away = 'away' then
      next_home_score := next_home_score + 1;
    else
      next_away_score := next_away_score + 1;
    end if;
  end if;

  update public.match_days
  set
    home_score = next_home_score,
    away_score = next_away_score,
    status = case when status in ('scheduled', 'scorer_request') then 'live' else status end,
    updated_at = timezone('utc', now())
  where id = match_row.id;

  insert into public.match_day_events (
    match_day_id,
    club_id,
    team_id,
    event_type,
    team_side,
    minute,
    scorer_name,
    scorer_initials,
    scorer_shirt_number,
    assist_name,
    assist_initials,
    assist_shirt_number,
    home_score,
    away_score,
    notes,
    created_by,
    created_by_parent_link_id,
    created_by_name
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    'goal',
    normalized_team_side,
    minute_value,
    trim(coalesce(scorer_name_value, '')),
    public.get_initials_from_full_name(scorer_name_value),
    trim(coalesce(scorer_shirt_number_value, '')),
    trim(coalesce(assist_name_value, '')),
    public.get_initials_from_full_name(assist_name_value),
    trim(coalesce(assist_shirt_number_value, '')),
    next_home_score,
    next_away_score,
    trim(coalesce(notes_value, '')),
    auth.uid(),
    link_row.id,
    coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, '')
  )
  returning id into event_id_value;

  return event_id_value;
end;
$$;

grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) to authenticated;
