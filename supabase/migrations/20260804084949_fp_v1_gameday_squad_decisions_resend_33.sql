-- FP-V1-GAMEDAY-SQUAD-DECISIONS-RESEND-33

create or replace function public.event_player_eligible_recipients(
  club_id_value uuid,
  team_id_value uuid,
  player_ids_value uuid[]
)
returns table (
  player_id uuid,
  player_name text,
  recipient_email text,
  recipient_name text,
  recipient_type text,
  parent_link_id uuid
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_players as (
    select
      player.id,
      coalesce(nullif(btrim(player.player_name), ''), 'Player') as player_name,
      lower(btrim(coalesce(player.parent_email, ''))) as configured_email,
      lower(btrim(coalesce(player.contact_type, 'parent'))) as contact_type
    from public.players player
    where player.club_id = club_id_value
      and player.team_id = team_id_value
      and player.id = any(coalesce(player_ids_value, '{}'::uuid[]))
      and coalesce(player.status, 'active') = 'active'
      and player.archived_at is null
  ),
  active_parent_links as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(link.email)) as recipient_email,
      coalesce(
        nullif(btrim(parent_profile.display_name), ''),
        nullif(btrim(parent_profile.name), ''),
        'Parent or guardian'
      ) as recipient_name,
      'parent'::text as recipient_type,
      link.id as parent_link_id,
      1 as priority
    from selected_players player
    join public.parent_player_links link
      on link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = player.id
      and link.status = 'active'
      and link.auth_user_id is not null
    join public.users parent_profile
      on parent_profile.id = link.auth_user_id
      and parent_profile.club_id = club_id_value
      and coalesce(parent_profile.status, 'active') = 'active'
      and lower(btrim(coalesce(parent_profile.email, ''))) = lower(btrim(coalesce(link.email, '')))
    where player.contact_type in ('parent', 'both')
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  active_adult_players as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(adult_auth.email)) as recipient_email,
      coalesce(
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'name'), ''),
        player.player_name
      ) as recipient_name,
      'player'::text as recipient_type,
      null::uuid as parent_link_id,
      2 as priority
    from selected_players player
    join public.adult_player_account_links adult_link
      on adult_link.club_id = club_id_value
      and adult_link.team_id = team_id_value
      and adult_link.player_id = player.id
      and adult_link.status = 'active'
      and adult_link.verified_at is not null
      and adult_link.revoked_at is null
    join auth.users adult_auth
      on adult_auth.id = adult_link.user_id
      and adult_auth.deleted_at is null
      and adult_auth.email_confirmed_at is not null
      and (adult_auth.banned_until is null or adult_auth.banned_until <= timezone('utc', now()))
    where player.contact_type in ('self', 'both')
      and lower(btrim(coalesce(adult_auth.email, ''))) = player.configured_email
      and btrim(coalesce(adult_auth.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  candidates as (
    select * from active_parent_links
    union all
    select * from active_adult_players
  )
  select distinct on (candidate.player_id, candidate.recipient_email)
    candidate.player_id,
    candidate.player_name,
    candidate.recipient_email,
    candidate.recipient_name,
    candidate.recipient_type,
    candidate.parent_link_id
  from candidates candidate
  where candidate.recipient_email <> ''
  order by candidate.player_id, candidate.recipient_email, candidate.priority, candidate.parent_link_id nulls last;
$$;

revoke all on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
to service_role;

drop trigger if exists zz_match_day_selection_parent_email
on public.match_day_player_squad_decisions;

create or replace function public.set_match_day_player_squad_decision(
  match_day_id_value uuid,
  player_id_value uuid,
  decision_value text
)
returns table (
  id uuid,
  match_day_id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  status text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_decision text := lower(trim(coalesce(decision_value, '')));
  actor_row public.users%rowtype;
  match_row public.match_days%rowtype;
  player_row public.players%rowtype;
  previous_row public.match_day_player_squad_decisions%rowtype;
  saved_row public.match_day_player_squad_decisions%rowtype;
  actor_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required.';
  end if;

  if normalized_decision not in ('undecided', 'waiting', 'selected', 'not_selected') then
    raise exception 'Choose Selected, Waiting, Not selected, or Undecided.';
  end if;

  select staff.*
  into actor_row
  from public.users staff
  where staff.id = (select auth.uid())
    and coalesce(staff.status, 'active') = 'active'
  limit 1;

  if actor_row.id is null
    or actor_row.club_id is null
    or actor_row.role in ('parent_portal', 'super_admin')
    or coalesce(actor_row.role_rank, 0) < 20 then
    raise exception 'Only active authorised team staff can change squad decisions.';
  end if;

  select fixture.*
  into match_row
  from public.match_days fixture
  where fixture.id = match_day_id_value
  limit 1;

  if match_row.id is null then
    raise exception 'Fixture not found.';
  end if;

  if match_row.club_id <> actor_row.club_id then
    raise exception 'This fixture is outside your club.';
  end if;

  if match_row.team_id is null or not public.can_manage_match_day(match_row.team_id) then
    raise exception 'You are not authorised for this fixture team.';
  end if;

  if match_row.status not in ('scheduled', 'scorer_request') then
    raise exception 'Squad decisions are locked for this fixture lifecycle.';
  end if;

  if match_row.previous_hidden_at is not null then
    raise exception 'Squad decisions are locked for an archived fixture.';
  end if;

  select player.*
  into player_row
  from public.players player
  where player.id = player_id_value
  limit 1;

  if player_row.id is null
    or player_row.club_id <> match_row.club_id
    or player_row.team_id is distinct from match_row.team_id
    or player_row.section <> 'Squad'
    or coalesce(player_row.status, 'active') = 'archived' then
    raise exception 'This player is not an active squad player for the fixture team.';
  end if;

  select decision.*
  into previous_row
  from public.match_day_player_squad_decisions decision
  where decision.match_day_id = match_row.id
    and decision.player_id = player_row.id
  limit 1;

  if previous_row.id is not null and previous_row.status = normalized_decision then
    return query
    select
      previous_row.id,
      previous_row.match_day_id,
      previous_row.club_id,
      previous_row.team_id,
      previous_row.player_id,
      previous_row.status,
      previous_row.decided_by,
      previous_row.decided_by_name,
      previous_row.decided_at,
      previous_row.created_at,
      previous_row.updated_at;
    return;
  end if;

  actor_name := coalesce(
    nullif(actor_row.display_name, ''),
    nullif(actor_row.name, ''),
    nullif(actor_row.email, ''),
    'Team staff'
  );

  insert into public.match_day_player_squad_decisions (
    match_day_id,
    club_id,
    team_id,
    player_id,
    status,
    decided_by,
    decided_by_name,
    decided_at,
    updated_at
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    player_row.id,
    normalized_decision,
    actor_row.id,
    actor_name,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict on constraint match_day_player_squad_decisions_match_player_key
  do update
  set status = excluded.status,
      club_id = excluded.club_id,
      team_id = excluded.team_id,
      decided_by = excluded.decided_by,
      decided_by_name = excluded.decided_by_name,
      decided_at = excluded.decided_at,
      updated_at = timezone('utc', now())
  returning *
  into saved_row;

  insert into public.match_day_event_log (
    club_id,
    team_id,
    match_day_id,
    player_id,
    actor_user_id,
    actor_display_name,
    actor_role,
    event_type,
    event_label,
    previous_value,
    new_value,
    metadata
  )
  values (
    saved_row.club_id,
    saved_row.team_id,
    saved_row.match_day_id,
    saved_row.player_id,
    actor_row.id,
    actor_name,
    coalesce(nullif(actor_row.role_label, ''), actor_row.role, ''),
    'player_squad_decision_changed',
    'Player squad decision changed',
    jsonb_build_object('status', coalesce(previous_row.status, 'undecided')),
    jsonb_build_object('status', saved_row.status),
    jsonb_build_object('source', 'game_day_invited_player_manager')
  );

  return query
  select
    saved_row.id,
    saved_row.match_day_id,
    saved_row.club_id,
    saved_row.team_id,
    saved_row.player_id,
    saved_row.status,
    saved_row.decided_by,
    saved_row.decided_by_name,
    saved_row.decided_at,
    saved_row.created_at,
    saved_row.updated_at;
end;
$$;

revoke all on function public.set_match_day_player_squad_decision(uuid, uuid, text)
from public;
revoke execute on function public.set_match_day_player_squad_decision(uuid, uuid, text)
from anon;
grant execute on function public.set_match_day_player_squad_decision(uuid, uuid, text)
to service_role;

create or replace function public.set_match_day_player_squad_decision_v2(
  match_day_id_value uuid,
  player_id_value uuid,
  decision_value text,
  expected_decided_at_value timestamptz default null
)
returns table (
  id uuid,
  match_day_id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  status text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_decision text := lower(trim(coalesce(decision_value, '')));
  current_row public.match_day_player_squad_decisions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required.';
  end if;

  if match_day_id_value is null or player_id_value is null then
    raise exception 'Choose a fixture and player before changing the squad decision.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat(match_day_id_value::text, ':', player_id_value::text),
    0
  ));

  select decision.*
  into current_row
  from public.match_day_player_squad_decisions decision
  where decision.match_day_id = match_day_id_value
    and decision.player_id = player_id_value
  limit 1;

  if current_row.id is not null and current_row.status = normalized_decision then
    return query
    select
      current_row.id,
      current_row.match_day_id,
      current_row.club_id,
      current_row.team_id,
      current_row.player_id,
      current_row.status,
      current_row.decided_by,
      current_row.decided_by_name,
      current_row.decided_at,
      current_row.created_at,
      current_row.updated_at;
    return;
  end if;

  if (
    current_row.id is null and expected_decided_at_value is not null
  ) or (
    current_row.id is not null
    and current_row.decided_at is distinct from expected_decided_at_value
  ) then
    raise exception 'This squad decision changed after you opened the fixture. Refresh Match Day and try again.';
  end if;

  return query
  select saved.*
  from public.set_match_day_player_squad_decision(
    match_day_id_value,
    player_id_value,
    normalized_decision
  ) saved;
end;
$$;

revoke all on function public.set_match_day_player_squad_decision_v2(uuid, uuid, text, timestamptz)
from public;
revoke execute on function public.set_match_day_player_squad_decision_v2(uuid, uuid, text, timestamptz)
from anon;
grant execute on function public.set_match_day_player_squad_decision_v2(uuid, uuid, text, timestamptz)
to authenticated, service_role;

comment on function public.event_player_eligible_recipients(uuid, uuid, uuid[]) is
  'Returns only active same-club and same-team Parent, guardian, and verified adult-Player recipients.';

comment on function public.set_match_day_player_squad_decision(uuid, uuid, text) is
  'Server-authoritative Game Day squad decision action. Availability remains independent and no Parent communication is triggered.';

comment on function public.set_match_day_player_squad_decision_v2(uuid, uuid, text, timestamptz) is
  'Atomic idempotent Game Day squad decision action with stale-write protection.';
