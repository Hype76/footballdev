create table public.player_team_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive')),
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  ended_reason text,
  ended_source text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint player_team_memberships_lifecycle_check check (
    (status = 'active' and ended_at is null)
    or (status = 'inactive' and ended_at is not null and btrim(coalesce(ended_reason, '')) <> '')
  )
);

create unique index player_team_memberships_one_active_key
on public.player_team_memberships (player_id, team_id)
where status = 'active';

create index player_team_memberships_team_active_idx
on public.player_team_memberships (club_id, team_id, player_id)
where status = 'active';

insert into public.player_team_memberships (club_id, team_id, player_id, status, started_at)
select player.club_id, player.team_id, player.id, 'active', player.created_at
from public.players player
join public.teams team
  on team.id = player.team_id
  and team.club_id = player.club_id
where player.team_id is not null
  and coalesce(player.status, 'active') <> 'archived'
on conflict (player_id, team_id) where status = 'active' do nothing;

alter table public.player_team_memberships enable row level security;
revoke all on public.player_team_memberships from public, anon, authenticated;
grant select on public.player_team_memberships to authenticated, service_role;
grant insert, update, delete on public.player_team_memberships to service_role;

create policy player_team_memberships_select_scoped
on public.player_team_memberships
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and (
    public.current_user_role() = 'admin'
    or exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = player_team_memberships.team_id
        and assignment.user_id = auth.uid()
    )
    or exists (
      select 1 from public.parent_player_links link
      where link.player_id = player_team_memberships.player_id
        and link.team_id = player_team_memberships.team_id
        and link.auth_user_id = auth.uid()
        and link.status = 'active'
    )
    or exists (
      select 1 from public.adult_player_account_links link
      where link.player_id = player_team_memberships.player_id
        and link.team_id = player_team_memberships.team_id
        and link.user_id = auth.uid()
        and link.status = 'active'
        and link.revoked_at is null
    )
  )
);

create or replace function public.sync_player_team_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.preserve_player_team_memberships', true) = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.team_id is not null
    and (
      old.team_id is distinct from new.team_id
      or (coalesce(old.status, 'active') <> 'archived' and coalesce(new.status, 'active') = 'archived')
    ) then
    update public.player_team_memberships membership
    set status = 'inactive',
        ended_at = timezone('utc', now()),
        ended_by = auth.uid(),
        ended_reason = case when coalesce(new.status, 'active') = 'archived' then 'Player record archived.' else 'Player moved to another Team.' end,
        ended_source = 'players_compatibility_trigger'
    where membership.player_id = old.id
      and membership.team_id = old.team_id
      and membership.status = 'active';
  end if;

  if new.team_id is not null
    and coalesce(new.status, 'active') <> 'archived'
    and (
      tg_op = 'INSERT'
      or old.team_id is distinct from new.team_id
      or coalesce(old.status, 'active') = 'archived'
    ) then
    insert into public.player_team_memberships (club_id, team_id, player_id, status)
    values (new.club_id, new.team_id, new.id, 'active')
    on conflict (player_id, team_id) where status = 'active' do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists players_sync_team_membership on public.players;
create trigger players_sync_team_membership
after insert or update of team_id, status on public.players
for each row execute function public.sync_player_team_membership();

create table public.player_team_removal_commands (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  membership_id uuid not null references public.player_team_memberships(id) on delete restrict,
  scope text not null check (scope in ('team_only', 'team_and_future_events')),
  request_token uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  previous_state jsonb not null,
  new_state jsonb not null,
  affected_occurrence_count integer not null default 0 check (affected_occurrence_count >= 0),
  suppressed_invitation_count integer not null default 0 check (suppressed_invitation_count >= 0),
  revoked_token_count integer not null default 0 check (revoked_token_count >= 0),
  result jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint player_team_removal_commands_actor_request_key unique (requested_by, request_token)
);

create index player_team_removal_commands_scope_idx
on public.player_team_removal_commands (club_id, team_id, player_id, created_at desc);

alter table public.player_team_removal_commands enable row level security;
revoke all on public.player_team_removal_commands from public, anon, authenticated;
grant select on public.player_team_removal_commands to authenticated, service_role;
grant insert on public.player_team_removal_commands to service_role;

create policy player_team_removal_commands_select_scoped
on public.player_team_removal_commands
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.current_user_role() <> 'super_admin'
  and (
    public.current_user_role() = 'admin'
    or exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = player_team_removal_commands.team_id
        and assignment.user_id = auth.uid()
    )
  )
);

create or replace function public.preview_player_team_removal(
  player_id_value uuid,
  team_id_value uuid,
  scope_value text default 'team_only'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  membership public.player_team_memberships%rowtype;
  normalized_scope text := lower(btrim(coalesce(scope_value, '')));
  event_row record;
  first_date date;
  cursor_date date;
  cursor_start timestamptz;
  cursor_end timestamptz;
  duration_value interval;
  standalone_count integer := 0;
  recurring_count integer := 0;
  unsent_count integer := 0;
  token_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to remove a Player from a Team.';
  end if;

  if normalized_scope not in ('team_only', 'team_and_future_events') then
    raise exception 'Choose Remove from Team only or Remove from Team and future events.';
  end if;

  select profile.* into actor
  from public.users profile
  where profile.id = auth.uid()
  limit 1;

  if actor.id is null
    or actor.club_id is null
    or actor.role in ('parent_portal', 'adult_player', 'super_admin')
    or coalesce(actor.status, 'active') <> 'active'
    or coalesce(actor.role_rank, 0) < 50 then
    raise exception 'Team Admin or Manager access is required to remove a Player from a Team.';
  end if;

  if not exists (
    select 1 from public.teams team
    where team.id = team_id_value and team.club_id = actor.club_id
  ) then
    raise exception 'The selected Team was not found in the active club.';
  end if;

  if actor.role <> 'admin' and not exists (
    select 1 from public.team_staff assignment
    where assignment.team_id = team_id_value and assignment.user_id = actor.id
  ) then
    raise exception 'You do not have permission to remove Players from this Team.';
  end if;

  select member.* into membership
  from public.player_team_memberships member
  join public.players player
    on player.id = member.player_id
    and player.club_id = member.club_id
    and coalesce(player.status, 'active') <> 'archived'
  where member.player_id = player_id_value
    and member.team_id = team_id_value
    and member.club_id = actor.club_id
    and member.status = 'active'
  limit 1;

  if membership.id is null then
    raise exception 'The Player does not have an active membership for this Team.';
  end if;

  for event_row in
    select event.*
    from public.calendar_events event
    where event.club_id = actor.club_id
      and event.team_id = team_id_value
      and event.cancelled_at is null
      and exists (
        select 1 from public.calendar_event_invites invite
        where invite.calendar_event_id = event.id
          and invite.player_id = player_id_value
          and invite.team_id = team_id_value
          and invite.invite_status <> 'cancelled'
          and invite.cancelled_at is null
      )
  loop
    first_date := (event_row.starts_at at time zone 'Europe/London')::date;
    duration_value := greatest(coalesce(event_row.ends_at, event_row.starts_at + interval '1 hour') - event_row.starts_at, interval '1 minute');

    if lower(coalesce(event_row.recurrence_frequency, 'none')) = 'none' then
      if coalesce(event_row.ends_at, event_row.starts_at + interval '1 hour') > timezone('utc', now()) then
        standalone_count := standalone_count + 1;
      end if;
    else
      cursor_date := first_date;
      while cursor_date <= coalesce(event_row.recurrence_until, first_date) loop
        cursor_start := event_row.starts_at + (cursor_date - first_date) * interval '1 day';
        cursor_end := cursor_start + duration_value;
        if cursor_end > timezone('utc', now())
          and not public.is_calendar_event_player_excluded_internal(event_row.id, player_id_value, cursor_date) then
          recurring_count := recurring_count + 1;
        end if;
        cursor_date := case lower(event_row.recurrence_frequency)
          when 'weekly' then cursor_date + 7
          when 'fortnightly' then cursor_date + 14
          when 'monthly' then (cursor_date + interval '1 month')::date
          else coalesce(event_row.recurrence_until, first_date) + 1
        end;
      end loop;
    end if;
  end loop;

  select standalone_count + count(distinct fixture.id) into standalone_count
  from public.match_days fixture
  where fixture.club_id = actor.club_id
    and fixture.team_id = team_id_value
    and fixture.deleted_at is null
    and coalesce(fixture.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
    and (
      case when fixture.kickoff_time_tbc or fixture.kickoff_time is null
        then fixture.match_date::timestamp at time zone 'Europe/London' + interval '2 hours'
        else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London' + interval '2 hours'
      end
    ) > timezone('utc', now())
    and (
      exists (select 1 from public.calendar_event_invites invite where invite.match_day_id = fixture.id and invite.player_id = player_id_value and invite.invite_status <> 'cancelled' and invite.cancelled_at is null)
      or exists (select 1 from public.match_day_player_squad_decisions decision where decision.match_day_id = fixture.id and decision.player_id = player_id_value and decision.status = 'selected')
      or exists (select 1 from public.match_day_availability_requests request where request.match_day_id = fixture.id and request.player_id = player_id_value and request.token_revoked_at is null)
    );

  select count(distinct queue.id) into unsent_count
  from public.scheduled_email_queue queue
  where queue.club_id = actor.club_id
    and queue.team_id = team_id_value
    and queue.provider_message_id is null
    and queue.provider_accepted_at is null
    and queue.delivery_state not in ('cancelled', 'delivered', 'bounced', 'failed')
    and (
      exists (
        select 1 from public.match_day_availability_requests request
        join public.match_days fixture on fixture.id = request.match_day_id
        where request.player_id = player_id_value
          and fixture.team_id = team_id_value
          and request.id::text = queue.payload #>> '{matchDayAvailability,requestId}'
      )
      or exists (
        select 1 from public.training_availability_request_players recipient
        join public.training_availability_requests request on request.id = recipient.request_id
        join public.calendar_events event on event.id = request.calendar_event_id
        where recipient.player_id = player_id_value
          and event.team_id = team_id_value
          and recipient.email_queue_id = queue.id
      )
    );

  select
    (select count(*) from public.match_day_availability_requests request join public.match_days fixture on fixture.id = request.match_day_id where request.player_id = player_id_value and fixture.team_id = team_id_value and request.token_revoked_at is null)
    +
    (select count(*) from public.training_availability_request_players recipient join public.training_availability_requests request on request.id = recipient.request_id join public.calendar_events event on event.id = request.calendar_event_id where recipient.player_id = player_id_value and event.team_id = team_id_value and recipient.token_revoked_at is null)
  into token_count;

  return jsonb_build_object(
    'playerId', player_id_value,
    'teamId', team_id_value,
    'clubId', actor.club_id,
    'scope', normalized_scope,
    'teamMembershipAffected', 1,
    'upcomingStandaloneEventsAffected', case when normalized_scope = 'team_and_future_events' then standalone_count else 0 end,
    'recurringOccurrencesAffected', case when normalized_scope = 'team_and_future_events' then recurring_count else 0 end,
    'futureConfiguredEventCount', standalone_count + recurring_count,
    'unsentInvitationsSuppressed', case when normalized_scope = 'team_and_future_events' then unsent_count else 0 end,
    'responseLinksRevoked', case when normalized_scope = 'team_and_future_events' then token_count else 0 end,
    'historicalRecordsPreserved', true,
    'playerRecordPreserved', true,
    'otherTeamMembershipsPreserved', true,
    'communicationWillBeSent', false
  );
end;
$$;

revoke all on function public.preview_player_team_removal(uuid, uuid, text) from public, anon;
grant execute on function public.preview_player_team_removal(uuid, uuid, text) to authenticated, service_role;

create or replace function public.remove_player_from_team(
  player_id_value uuid,
  team_id_value uuid,
  scope_value text default 'team_only',
  request_token_value uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  membership public.player_team_memberships%rowtype;
  existing_command public.player_team_removal_commands%rowtype;
  preview jsonb;
  event_row record;
  removal_result jsonb;
  normalized_scope text := lower(btrim(coalesce(scope_value, '')));
  original_team_id uuid;
  replacement_team_id uuid;
  replacement_team_name text := '';
  first_date date;
  cursor_date date;
  cursor_start timestamptz;
  cursor_end timestamptz;
  duration_value interval;
  child_hash text;
  child_token uuid;
  affected_count integer := 0;
  suppressed_count integer := 0;
  revoked_count integer := 0;
  command_id_value uuid;
  result_value jsonb;
begin
  if request_token_value is null then
    raise exception 'A Team removal request token is required.';
  end if;

  select profile.* into actor from public.users profile where profile.id = auth.uid() limit 1;
  if actor.id is null then
    raise exception 'Authentication is required to remove a Player from a Team.';
  end if;

  select command.* into existing_command
  from public.player_team_removal_commands command
  where command.requested_by = actor.id and command.request_token = request_token_value
  limit 1;

  if existing_command.id is not null then
    if existing_command.player_id <> player_id_value
      or existing_command.team_id <> team_id_value
      or existing_command.scope <> normalized_scope then
      raise exception 'This Team removal request token was already used for another action.';
    end if;
    return existing_command.result || jsonb_build_object('duplicate', true, 'commandId', existing_command.id);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(concat('player-team-removal:', player_id_value::text, ':', team_id_value::text), 0)
  );

  preview := public.preview_player_team_removal(player_id_value, team_id_value, normalized_scope);

  select member.* into membership
  from public.player_team_memberships member
  where member.player_id = player_id_value
    and member.team_id = team_id_value
    and member.status = 'active'
  limit 1;

  select player.team_id into original_team_id
  from public.players player
  where player.id = player_id_value and player.club_id = actor.club_id
  for update;

  if normalized_scope = 'team_and_future_events' then
    if original_team_id is distinct from team_id_value then
      perform pg_catalog.set_config('app.preserve_player_team_memberships', 'on', true);
      update public.players player
      set team_id = team_id_value,
          team = coalesce((select team.name from public.teams team where team.id = team_id_value), player.team)
      where player.id = player_id_value and player.club_id = actor.club_id;
      perform pg_catalog.set_config('app.preserve_player_team_memberships', 'off', true);
    end if;

    for event_row in
      select fixture.id
      from public.match_days fixture
      where fixture.club_id = actor.club_id
        and fixture.team_id = team_id_value
        and fixture.deleted_at is null
        and coalesce(fixture.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
        and (case when fixture.kickoff_time_tbc or fixture.kickoff_time is null then fixture.match_date::timestamp at time zone 'Europe/London' + interval '2 hours' else (fixture.match_date + fixture.kickoff_time)::timestamp at time zone 'Europe/London' + interval '2 hours' end) > timezone('utc', now())
        and (
          exists (select 1 from public.calendar_event_invites invite where invite.match_day_id = fixture.id and invite.player_id = player_id_value and invite.invite_status <> 'cancelled' and invite.cancelled_at is null)
          or exists (select 1 from public.match_day_player_squad_decisions decision where decision.match_day_id = fixture.id and decision.player_id = player_id_value and decision.status = 'selected')
          or exists (select 1 from public.match_day_availability_requests request where request.match_day_id = fixture.id and request.player_id = player_id_value and request.token_revoked_at is null)
        )
    loop
      child_hash := md5(request_token_value::text || ':match-day:' || event_row.id::text);
      child_token := (substr(child_hash,1,8)||'-'||substr(child_hash,9,4)||'-'||substr(child_hash,13,4)||'-'||substr(child_hash,17,4)||'-'||substr(child_hash,21,12))::uuid;
      removal_result := public.remove_player_from_event('match-day', event_row.id, player_id_value, null, 'event', child_token, true);
      affected_count := affected_count + coalesce((removal_result ->> 'affectedOccurrenceCount')::integer, 0);
      suppressed_count := suppressed_count + coalesce((removal_result ->> 'suppressedInvitationCount')::integer, 0);
      revoked_count := revoked_count + coalesce((removal_result ->> 'revokedTokenCount')::integer, 0);
    end loop;

    for event_row in
      select event.*
      from public.calendar_events event
      where event.club_id = actor.club_id
        and event.team_id = team_id_value
        and event.cancelled_at is null
        and exists (
          select 1 from public.calendar_event_invites invite
          where invite.calendar_event_id = event.id
            and invite.player_id = player_id_value
            and invite.invite_status <> 'cancelled'
            and invite.cancelled_at is null
        )
    loop
      first_date := (event_row.starts_at at time zone 'Europe/London')::date;
      duration_value := greatest(coalesce(event_row.ends_at, event_row.starts_at + interval '1 hour') - event_row.starts_at, interval '1 minute');
      cursor_date := null;

      if lower(coalesce(event_row.recurrence_frequency, 'none')) = 'none' then
        if coalesce(event_row.ends_at, event_row.starts_at + interval '1 hour') > timezone('utc', now()) then
          child_hash := md5(request_token_value::text || ':calendar:' || event_row.id::text);
          child_token := (substr(child_hash,1,8)||'-'||substr(child_hash,9,4)||'-'||substr(child_hash,13,4)||'-'||substr(child_hash,17,4)||'-'||substr(child_hash,21,12))::uuid;
          removal_result := public.remove_player_from_event('calendar', event_row.id, player_id_value, null, 'event', child_token, true);
        else
          continue;
        end if;
      else
        cursor_date := first_date;
        while cursor_date <= coalesce(event_row.recurrence_until, first_date) loop
          cursor_start := event_row.starts_at + (cursor_date - first_date) * interval '1 day';
          cursor_end := cursor_start + duration_value;
          exit when cursor_end > timezone('utc', now())
            and not public.is_calendar_event_player_excluded_internal(event_row.id, player_id_value, cursor_date);
          cursor_date := case lower(event_row.recurrence_frequency)
            when 'weekly' then cursor_date + 7
            when 'fortnightly' then cursor_date + 14
            when 'monthly' then (cursor_date + interval '1 month')::date
            else coalesce(event_row.recurrence_until, first_date) + 1
          end;
        end loop;

        if cursor_date > coalesce(event_row.recurrence_until, first_date) then
          continue;
        end if;
        child_hash := md5(request_token_value::text || ':calendar:' || event_row.id::text || ':' || cursor_date::text);
        child_token := (substr(child_hash,1,8)||'-'||substr(child_hash,9,4)||'-'||substr(child_hash,13,4)||'-'||substr(child_hash,17,4)||'-'||substr(child_hash,21,12))::uuid;
        removal_result := public.remove_player_from_event('calendar', event_row.id, player_id_value, cursor_date, 'this_and_future', child_token, true);
      end if;

      affected_count := affected_count + coalesce((removal_result ->> 'affectedOccurrenceCount')::integer, 0);
      suppressed_count := suppressed_count + coalesce((removal_result ->> 'suppressedInvitationCount')::integer, 0);
      revoked_count := revoked_count + coalesce((removal_result ->> 'revokedTokenCount')::integer, 0);
    end loop;
  end if;

  update public.player_team_memberships member
  set status = 'inactive',
      ended_at = timezone('utc', now()),
      ended_by = actor.id,
      ended_reason = case when normalized_scope = 'team_only' then 'Removed from Team only.' else 'Removed from Team and future events.' end,
      ended_source = 'remove_player_from_team'
  where member.id = membership.id and member.status = 'active';

  select member.team_id, team.name into replacement_team_id, replacement_team_name
  from public.player_team_memberships member
  join public.teams team on team.id = member.team_id and team.club_id = member.club_id
  where member.player_id = player_id_value
    and member.status = 'active'
    and member.team_id <> team_id_value
  order by member.started_at, member.id
  limit 1;

  perform pg_catalog.set_config('app.preserve_player_team_memberships', 'on', true);
  update public.players
  set team_id = replacement_team_id,
      team = coalesce(replacement_team_name, ''),
      updated_by = actor.id,
      updated_by_name = coalesce(nullif(btrim(actor.display_name), ''), nullif(btrim(actor.name), ''), 'Team staff'),
      updated_by_email = coalesce(actor.email, '')
  where id = player_id_value and club_id = actor.club_id;
  perform pg_catalog.set_config('app.preserve_player_team_memberships', 'off', true);

  result_value := preview || jsonb_build_object(
    'duplicate', false,
    'status', 'completed',
    'membershipId', membership.id,
    'teamMembershipStatus', 'inactive',
    'affectedOccurrenceCount', affected_count,
    'suppressedInvitationCount', suppressed_count,
    'revokedTokenCount', revoked_count,
    'playerRecordPreserved', true,
    'historyPreserved', true,
    'parentLinksPreserved', true,
    'otherTeamMembershipsPreserved', true,
    'replacementTeamId', replacement_team_id,
    'communicationSent', false
  );

  insert into public.player_team_removal_commands (
    club_id, team_id, player_id, membership_id, scope, request_token, requested_by,
    previous_state, new_state, affected_occurrence_count, suppressed_invitation_count,
    revoked_token_count, result
  ) values (
    actor.club_id, team_id_value, player_id_value, membership.id, normalized_scope,
    request_token_value, actor.id,
    jsonb_build_object('membershipStatus', 'active', 'compatibilityTeamId', original_team_id),
    jsonb_build_object('membershipStatus', 'inactive', 'compatibilityTeamId', replacement_team_id, 'playerRecord', 'preserved', 'history', 'preserved'),
    affected_count, suppressed_count, revoked_count, result_value
  ) returning id into command_id_value;

  result_value := result_value || jsonb_build_object('commandId', command_id_value);
  update public.player_team_removal_commands set result = result_value where id = command_id_value;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, outcome, metadata)
  values (
    actor.club_id, actor.id, 'player_removed_from_team', 'player', player_id_value, 'success',
    jsonb_build_object(
      'commandId', command_id_value,
      'playerId', player_id_value,
      'clubId', actor.club_id,
      'teamId', team_id_value,
      'scope', normalized_scope,
      'previousState', jsonb_build_object('membershipStatus', 'active', 'compatibilityTeamId', original_team_id),
      'newState', jsonb_build_object('membershipStatus', 'inactive', 'compatibilityTeamId', replacement_team_id),
      'affectedOccurrenceCount', affected_count,
      'suppressedInvitationCount', suppressed_count,
      'revokedTokenCount', revoked_count,
      'communicationSent', false,
      'source', 'remove_player_from_team'
    )
  );

  return result_value;
end;
$$;

revoke all on function public.remove_player_from_team(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.remove_player_from_team(uuid, uuid, text, uuid) to authenticated, service_role;

create or replace function public.get_team_players(team_id_value uuid)
returns setof public.players
language sql
stable
security definer
set search_path = ''
as $$
  select (
    jsonb_populate_record(
      null::public.players,
      to_jsonb(player) || jsonb_build_object('team_id', team.id, 'team', team.name)
    )
  ).*
  from public.player_team_memberships membership
  join public.players player
    on player.id = membership.player_id
    and player.club_id = membership.club_id
    and coalesce(player.status, 'active') <> 'archived'
  join public.teams team
    on team.id = membership.team_id
    and team.club_id = membership.club_id
  where membership.team_id = team_id_value
    and membership.status = 'active'
    and membership.club_id = public.current_user_club_id()
    and public.current_user_role() <> 'super_admin'
    and public.current_user_role_rank() >= 20
    and (
      public.current_user_role() = 'admin'
      or exists (
        select 1 from public.team_staff assignment
        where assignment.team_id = membership.team_id
          and assignment.user_id = auth.uid()
      )
    )
  order by player.section, player.player_name;
$$;

revoke all on function public.get_team_players(uuid) from public, anon;
grant execute on function public.get_team_players(uuid) to authenticated, service_role;

create or replace function public.is_match_day_action_token_current_internal(token_hash_value text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.match_day_availability_requests request
    join public.match_days match_day on match_day.id = request.match_day_id and match_day.club_id = request.club_id and match_day.team_id = request.team_id
    join public.players player on player.id = request.player_id and player.club_id = request.club_id
    left join public.parent_player_links parent_link on parent_link.id = request.parent_link_id and parent_link.club_id = request.club_id and parent_link.team_id = request.team_id and parent_link.player_id = request.player_id and lower(btrim(parent_link.email)) = lower(btrim(request.recipient_email))
    left join lateral (
      select
        count(*) filter (where btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', '')) <> '')::integer usable_count,
        coalesce(bool_or(lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', ''))) = lower(btrim(request.recipient_email))), false) any_match,
        coalesce(bool_or(lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', ''))) = lower(btrim(request.recipient_email)) and lower(btrim(coalesce(contact ->> 'type', contact ->> 'contactType', 'parent'))) = 'self'), false) self_match,
        coalesce(bool_or(lower(btrim(coalesce(contact ->> 'email', contact ->> 'parentEmail', ''))) = lower(btrim(request.recipient_email)) and lower(btrim(coalesce(contact ->> 'type', contact ->> 'contactType', 'parent'))) <> 'self'), false) parent_match
      from jsonb_array_elements(coalesce(player.parent_contacts, '[]'::jsonb)) contact
    ) current_contacts on true
    where request.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and request.token_revoked_at is null
      and request.status <> 'expired'
      and request.expires_at >= timezone('utc', now())
      and match_day.deleted_at is null
      and coalesce(match_day.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
      and coalesce(player.status, 'active') <> 'archived'
      and (
        (request.parent_link_id is null and request.recipient_type = 'player'
          and exists (
            select 1 from public.adult_player_account_links adult_link
            join public.users adult_user on adult_user.id = adult_link.user_id and adult_user.club_id = request.club_id and coalesce(adult_user.status, 'active') = 'active' and lower(btrim(coalesce(adult_user.email, ''))) = lower(btrim(request.recipient_email))
            where adult_link.player_id = request.player_id and adult_link.club_id = request.club_id and adult_link.team_id = request.team_id and adult_link.status = 'active' and adult_link.revoked_at is null
          )
          and ((lower(btrim(coalesce(player.contact_type, 'parent'))) = 'self' and ((current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))) or (current_contacts.usable_count = 1 and current_contacts.any_match) or current_contacts.self_match)) or (lower(btrim(coalesce(player.contact_type, 'parent'))) = 'both' and current_contacts.self_match)))
        or (parent_link.id is not null and parent_link.status = 'active')
        or (request.parent_link_id is null and request.recipient_type = 'parent' and lower(btrim(coalesce(player.contact_type, 'parent'))) in ('parent', 'both') and ((current_contacts.usable_count = 0 and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))) or current_contacts.parent_match))
      )
  );
$$;

revoke all on function public.is_match_day_action_token_current_internal(text) from public, anon, authenticated;
grant execute on function public.is_match_day_action_token_current_internal(text) to service_role;

create or replace function public.is_training_availability_token_current_internal(token_hash_value text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.training_availability_request_players request_player
    join public.training_availability_requests request on request.id = request_player.request_id and request.calendar_event_id = request_player.calendar_event_id and request.club_id = request_player.club_id and request.team_id = request_player.team_id
    join public.calendar_events event on event.id = request.calendar_event_id and event.club_id = request.club_id and event.team_id = request.team_id
    join public.players player on player.id = request_player.player_id and player.club_id = request_player.club_id
    where request_player.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and request_player.token_revoked_at is null
      and lower(coalesce(request_player.status, '')) not in ('cancelled', 'expired')
      and lower(coalesce(request.status, '')) not in ('cancelled', 'expired')
      and coalesce(request_player.response_deadline_at, request.occurrence_starts_at) >= timezone('utc', now())
      and event.cancelled_at is null
      and lower(coalesce(player.status, 'active')) <> 'archived'
      and (
        (request_player.parent_link_id is not null and exists (select 1 from public.parent_player_links parent_link where parent_link.id = request_player.parent_link_id and parent_link.club_id = request_player.club_id and parent_link.team_id = request_player.team_id and parent_link.player_id = request_player.player_id and parent_link.status = 'active' and lower(btrim(coalesce(parent_link.email, ''))) = lower(btrim(request_player.recipient_email))))
        or (request_player.parent_link_id is null and request_player.recipient_type = 'player' and player.contact_type in ('self', 'both') and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email)) and exists (select 1 from public.adult_player_account_links adult_link join public.users adult_user on adult_user.id = adult_link.user_id and adult_user.club_id = request_player.club_id and coalesce(adult_user.status, 'active') = 'active' and lower(btrim(coalesce(adult_user.email, ''))) = lower(btrim(request_player.recipient_email)) where adult_link.player_id = request_player.player_id and adult_link.club_id = request_player.club_id and adult_link.team_id = request_player.team_id and adult_link.status = 'active' and adult_link.revoked_at is null))
        or (request_player.parent_link_id is null and request_player.recipient_type = 'parent' and coalesce(player.contact_type, 'parent') <> 'self' and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request_player.recipient_email)) and not exists (select 1 from public.parent_player_links active_parent_link where active_parent_link.club_id = request_player.club_id and active_parent_link.team_id = request_player.team_id and active_parent_link.player_id = request_player.player_id and active_parent_link.status = 'active'))
      )
  );
$$;

revoke all on function public.is_training_availability_token_current_internal(text) from public, anon, authenticated;
grant execute on function public.is_training_availability_token_current_internal(text) to service_role;

alter function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
rename to remove_player_from_event_membership_26b_internal;

revoke all on function public.remove_player_from_event_membership_26b_internal(text, uuid, uuid, date, text, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.remove_player_from_event_membership_26b_internal(text, uuid, uuid, date, text, uuid, boolean)
to service_role;

create function public.remove_player_from_event(
  source_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null,
  scope_value text default 'event',
  request_token_value uuid default null,
  confirm_in_progress_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_source_type text := lower(btrim(coalesce(source_type_value, '')));
  event_team_id uuid;
  event_club_id uuid;
  original_team_id uuid;
  original_team_name text;
  event_team_name text;
  result_value jsonb;
  has_event_participation boolean := false;
begin
  if normalized_source_type = 'calendar' then
    select event.club_id, event.team_id, team.name
    into event_club_id, event_team_id, event_team_name
    from public.calendar_events event
    join public.teams team on team.id = event.team_id and team.club_id = event.club_id
    where event.id = event_id_value and event.cancelled_at is null;

    select exists (
      select 1 from public.calendar_event_invites invite
      where invite.calendar_event_id = event_id_value
        and invite.player_id = player_id_value
        and invite.club_id = event_club_id
        and invite.team_id = event_team_id
        and invite.invite_status <> 'cancelled'
        and invite.cancelled_at is null
    ) into has_event_participation;
  elsif normalized_source_type = 'match-day' then
    select fixture.club_id, fixture.team_id, team.name
    into event_club_id, event_team_id, event_team_name
    from public.match_days fixture
    join public.teams team on team.id = fixture.team_id and team.club_id = fixture.club_id
    where fixture.id = event_id_value and fixture.deleted_at is null;

    select
      exists (select 1 from public.calendar_event_invites invite where invite.match_day_id = event_id_value and invite.player_id = player_id_value and invite.club_id = event_club_id and invite.team_id = event_team_id and invite.invite_status <> 'cancelled' and invite.cancelled_at is null)
      or exists (select 1 from public.match_day_player_squad_decisions decision where decision.match_day_id = event_id_value and decision.player_id = player_id_value and decision.club_id = event_club_id and decision.team_id = event_team_id and decision.status = 'selected')
      or exists (select 1 from public.match_day_availability_requests request where request.match_day_id = event_id_value and request.player_id = player_id_value and request.club_id = event_club_id and request.team_id = event_team_id and request.token_revoked_at is null)
    into has_event_participation;
  end if;

  select player.team_id, player.team
  into original_team_id, original_team_name
  from public.players player
  where player.id = player_id_value
    and player.club_id = event_club_id
    and coalesce(player.status, 'active') <> 'archived'
  for update;

  if original_team_id is distinct from event_team_id and has_event_participation then
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'on', true);
    update public.players
    set team_id = event_team_id, team = coalesce(event_team_name, team)
    where id = player_id_value and club_id = event_club_id;
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'off', true);
  end if;

  result_value := public.remove_player_from_event_membership_26b_internal(
    source_type_value,
    event_id_value,
    player_id_value,
    occurrence_date_value,
    scope_value,
    request_token_value,
    confirm_in_progress_value
  );

  if original_team_id is distinct from event_team_id and has_event_participation then
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'on', true);
    update public.players
    set team_id = original_team_id, team = original_team_name
    where id = player_id_value and club_id = event_club_id;
    perform pg_catalog.set_config('app.preserve_player_team_memberships', 'off', true);
  end if;

  return result_value;
end;
$$;

revoke all on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
from public, anon;
grant execute on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean)
to authenticated, service_role;

comment on table public.player_team_memberships is 'Immutable-period Team membership ledger. A Player can have one active period per Team and can belong to multiple Teams.';
comment on table public.player_team_removal_commands is 'Immutable idempotent audit ledger for explicit Team-only and Team-plus-future-event Player removal.';
comment on function public.preview_player_team_removal(uuid, uuid, text) is 'Returns server-authoritative Team membership and future-event impact counts without changing data.';
comment on function public.remove_player_from_team(uuid, uuid, text, uuid) is 'Atomically ends only the selected Team membership and optionally removes selected-Team future event participation without communication or history deletion.';
comment on function public.remove_player_from_event(text, uuid, uuid, date, text, uuid, boolean) is 'Preserves the 26B event-removal contract for Players whose selected-Team membership has already ended but whose explicit event participation remains active.';
