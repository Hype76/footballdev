-- Share canonical Player checks between own-user RPCs and the service worker.
-- Explicit-user helpers remain private. Own-user wrappers still use auth.uid().

create function app_private.adult_player_account_state_for_user(target_user_id uuid)
returns table (
  link_id uuid,
  user_id uuid,
  player_id uuid,
  player_name text,
  player_status text,
  date_of_birth date,
  contact_type text,
  club_id uuid,
  club_name text,
  club_logo_url text,
  club_contact_email text,
  team_id uuid,
  team_name text,
  theme_mode text,
  theme_accent text,
  theme_button_style text,
  link_status text,
  verified_at timestamptz,
  access_mode text,
  role_label text,
  access_granted boolean,
  denial_category text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_link_count integer := 0;
begin
  if target_user_id is null then
    return;
  end if;

  select count(*)
  into active_link_count
  from public.adult_player_account_links adult_link
  where adult_link.user_id = (select target_user_id)
    and adult_link.status = 'active';

  if active_link_count > 1 then
    return query
    select
      null::uuid,
      (select target_user_id),
      null::uuid,
      ''::text,
      ''::text,
      null::date,
      ''::text,
      null::uuid,
      ''::text,
      ''::text,
      ''::text,
      null::uuid,
      ''::text,
      ''::text,
      ''::text,
      ''::text,
      'active'::text,
      null::timestamptz,
      'player'::text,
      'Player'::text,
      false,
      'ambiguous_active_links'::text;
    return;
  end if;

  return query
  select
    adult_link.id,
    adult_link.user_id,
    adult_link.player_id,
    coalesce(nullif(player.player_name, ''), 'Player')::text,
    player.status,
    player.date_of_birth,
    player.contact_type,
    adult_link.club_id,
    coalesce(nullif(club.name, ''), 'Football club')::text,
    coalesce(club.logo_url, '')::text,
    coalesce(club.contact_email, '')::text,
    adult_link.team_id,
    coalesce(nullif(team.name, ''), nullif(player.team, ''), 'Team')::text,
    coalesce(team.theme_mode, '')::text,
    coalesce(club.theme_accent, team.theme_accent, '')::text,
    coalesce(club.theme_button_style, team.theme_button_style, '')::text,
    adult_link.status,
    adult_link.verified_at,
    'player'::text,
    'Player'::text,
    (
      adult_link.status = 'active'
      and player.status = 'active'
      and player.archived_at is null
      and player.club_id = adult_link.club_id
      and player.team_id = adult_link.team_id
      and team.club_id = adult_link.club_id
      and player.date_of_birth is not null
      and player.date_of_birth <= (current_date - interval '18 years')::date
      and player.contact_type in ('self', 'both')
    ),
    case
      when adult_link.status <> 'active' then 'link_revoked'
      when player.status <> 'active' or player.archived_at is not null then 'player_inactive'
      when player.club_id <> adult_link.club_id or player.team_id <> adult_link.team_id then 'scope_changed'
      when team.id is null or team.club_id <> adult_link.club_id then 'team_access_missing'
      when player.date_of_birth is null then 'date_of_birth_missing'
      when player.date_of_birth > (current_date - interval '18 years')::date then 'player_under_18'
      when player.contact_type not in ('self', 'both') then 'player_not_self_managed'
      else ''
    end::text
  from public.adult_player_account_links adult_link
  left join public.players player
    on player.id = adult_link.player_id
  left join public.clubs club
    on club.id = adult_link.club_id
  left join public.teams team
    on team.id = adult_link.team_id
  where adult_link.user_id = (select target_user_id)
  order by
    case when adult_link.status = 'active' then 0 else 1 end,
    adult_link.created_at desc
  limit 1;
end;
$$;

revoke all on function app_private.adult_player_account_state_for_user(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_own_adult_player_account_state()
returns table (
  link_id uuid,
  user_id uuid,
  player_id uuid,
  player_name text,
  player_status text,
  date_of_birth date,
  contact_type text,
  club_id uuid,
  club_name text,
  club_logo_url text,
  club_contact_email text,
  team_id uuid,
  team_name text,
  theme_mode text,
  theme_accent text,
  theme_button_style text,
  link_status text,
  verified_at timestamptz,
  access_mode text,
  role_label text,
  access_granted boolean,
  denial_category text
)
language sql stable security definer set search_path = '' as $$
  select * from app_private.adult_player_account_state_for_user(auth.uid());
$$;

create function app_private.adult_player_portal_context_for_user(target_user_id uuid)
returns table (link_id uuid, user_id uuid, player_id uuid, club_id uuid, team_id uuid,
  player_name text, history_cutoff timestamptz, email text)
language sql stable security definer set search_path = '' as $$
  select state.link_id, state.user_id, state.player_id, state.club_id, state.team_id,
    state.player_name, date_trunc('day', link.created_at), lower(btrim(account.email))
  from app_private.adult_player_account_state_for_user(target_user_id) state
  join public.adult_player_account_links link on link.id = state.link_id and link.user_id = target_user_id
  join auth.users account on account.id = state.user_id
  join public.players player on player.id = state.player_id and player.club_id = state.club_id and player.team_id = state.team_id
  join public.clubs club on club.id = state.club_id and club.status = 'active' and club.archived_at is null
  join public.teams team on team.id = state.team_id and team.club_id = club.id and team.status = 'active' and team.archived_at is null
  where state.access_granted and state.access_mode = 'player' and state.user_id = target_user_id
    and state.link_status = 'active' and state.verified_at is not null
    and link.status = 'active' and link.revoked_at is null and link.verified_at is not null
    and account.deleted_at is null and account.email_confirmed_at is not null
    and (account.banned_until is null or account.banned_until <= statement_timestamp())
    and nullif(btrim(account.email), '') is not null
    and player.status = 'active' and player.archived_at is null
    and player.date_of_birth <= (current_date - interval '18 years')::date
    and player.contact_type in ('self', 'both')
    and not exists (select 1 from public.users profile where profile.id = state.user_id
      and profile.status = 'suspended'
      and (profile.role in ('parent_portal', 'adult_player') or profile.club_id = state.club_id))
    and (select count(distinct lower(btrim(contact->>'email')))
      from jsonb_array_elements(case when jsonb_typeof(player.parent_contacts) = 'array' then player.parent_contacts else '[]'::jsonb end) contact
      where contact->>'type' = 'self' and nullif(btrim(contact->>'email'), '') is not null) = 1
    and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(player.parent_contacts) = 'array' then player.parent_contacts else '[]'::jsonb end) contact
      where contact->>'type' = 'self' and lower(btrim(contact->>'email')) = lower(btrim(account.email)));
$$;

revoke all on function app_private.adult_player_portal_context_for_user(uuid) from public,anon,authenticated,service_role;

create or replace function app_private.own_adult_player_portal_context()
returns table (link_id uuid, user_id uuid, player_id uuid, club_id uuid, team_id uuid,
  player_name text, history_cutoff timestamptz, email text)
language sql stable security definer set search_path = '' as $$
  select * from app_private.adult_player_portal_context_for_user(auth.uid());
$$;

create function app_private.adult_player_chat_context_for_user(target_user_id uuid)
returns table (link_id uuid, user_id uuid, player_id uuid, club_id uuid, team_id uuid,
  player_name text, history_cutoff timestamptz, community_type text)
language sql stable security definer set search_path = '' as $$
  select state.link_id, state.user_id, state.player_id, state.club_id, state.team_id,
    state.player_name, state.history_cutoff,
    case player_type.chat_group when 'team' then 'team' when 'training' then 'team_training'
      when 'match' then 'team_match' else '' end
  from app_private.adult_player_portal_context_for_user(target_user_id) state
  join public.players player on player.id = state.player_id
  left join public.club_player_types player_type
    on player_type.club_id = state.club_id and player_type.name = player.section
  where public.can_use_plan_feature(state.club_id, 'parentChat');
$$;

revoke all on function app_private.adult_player_chat_context_for_user(uuid) from public,anon,authenticated,service_role;

create or replace function app_private.own_adult_player_chat_context()
returns table (link_id uuid, user_id uuid, player_id uuid, club_id uuid, team_id uuid,
  player_name text, history_cutoff timestamptz, community_type text)
language sql stable security definer set search_path = '' as $$
  select * from app_private.adult_player_chat_context_for_user(auth.uid());
$$;

create function app_private.adult_player_chat_can_access_for_user(target_user_id uuid, target_room_id uuid, for_post boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.adult_player_chat_context_for_user(target_user_id) actor
    join public.parent_chat_rooms room on room.id = target_room_id
      and room.club_id = actor.club_id and room.team_id = actor.team_id
    where room.status in ('active', 'closed')
      and (not for_post or room.status = 'active')
      and (
        (room.room_type = 'player_staff' and room.player_id = actor.player_id)
        or (actor.community_type <> '' and room.room_type = actor.community_type)
        or (room.room_type = 'match_squad' and exists (
          select 1 from public.match_day_player_squad_decisions decision
          join public.match_days fixture on fixture.id = decision.match_day_id
            and fixture.club_id = actor.club_id and fixture.team_id = actor.team_id
          where decision.match_day_id = room.match_day_id and decision.player_id = actor.player_id
            and decision.club_id = actor.club_id and decision.team_id = actor.team_id
            and decision.status = 'selected' and fixture.deleted_at is null
            and fixture.previous_hidden_at is null
            and (not for_post or fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time'))
        ))
      )
  );
$$;

revoke all on function app_private.adult_player_chat_can_access_for_user(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function app_private.own_adult_player_chat_can_access(target_room_id uuid, for_post boolean default false)
returns boolean
language sql stable security definer set search_path = '' as $$
  select * from app_private.adult_player_chat_can_access_for_user(auth.uid(), target_room_id, for_post);
$$;

create function app_private.adult_player_invitation_state_for_user(target_user_id uuid)
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  event_id uuid,
  event_type text,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  response_state text,
  selection_state text,
  can_respond boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with adult_context as (
    select state.*
    from app_private.adult_player_account_state_for_user(target_user_id) state
    where state.access_granted is true
      and app_private.adult_player_contact_is_current(state.player_id, state.club_id, state.team_id, (select email from auth.users where id = target_user_id))
    limit 1
  ),
  calendar_items as (
    select
      concat('calendar:', invite.id)::text as invitation_id,
      'calendar_attendance'::text as invitation_type,
      invite.id as source_record_id,
      event.id as event_id,
      coalesce(nullif(event.event_type, ''), 'general')::text as event_type,
      coalesce(nullif(event.title, ''), 'Club event')::text as event_title,
      event.starts_at as event_start,
      event.ends_at as event_end,
      coalesce(event.location, '')::text as event_location,
      context.team_name,
      coalesce(invite.adult_response_status, 'awaiting_response')::text as response_state,
      'not_applicable'::text as selection_state,
      (invite.invite_status <> 'cancelled' and invite.cancelled_at is null and event.cancelled_at is null and event.starts_at > now()) as can_respond,
      case
        when invite.invite_status = 'cancelled' or invite.cancelled_at is not null or event.cancelled_at is not null then 'This event has been cancelled.'
        when event.starts_at <= now() then 'This event has closed.'
        else ''
      end::text as lock_reason,
      event.starts_at as response_deadline,
      invite.adult_responded_at as last_responded_at
    from adult_context context
    join public.calendar_event_invites invite
      on invite.club_id = context.club_id
      and invite.team_id = context.team_id
      and invite.player_id = context.player_id
      and invite.recipient_type in ('player', 'parent_and_player')
    join public.calendar_events event
      on event.id = invite.calendar_event_id
      and event.club_id = context.club_id
      and event.team_id = context.team_id
    where event.starts_at >= now() - interval '30 days'
      and event.event_type not in ('training', 'match_day')
      and lower(btrim(invite.player_contact_email)) = lower(btrim((select email from auth.users where id = target_user_id)))
  ),
  training_items as (
    select
      concat('training:', request_player.id)::text as invitation_id,
      'training_attendance'::text as invitation_type,
      request_player.id as source_record_id,
      request.calendar_event_id as event_id,
      'training'::text as event_type,
      coalesce(nullif(event.title, ''), 'Training')::text as event_title,
      request.occurrence_starts_at as event_start,
      request.occurrence_ends_at as event_end,
      coalesce(event.location, '')::text as event_location,
      context.team_name,
      coalesce(response.status, 'awaiting_response')::text as response_state,
      'not_applicable'::text as selection_state,
      (
        request.status not in ('cancelled', 'expired')
        and request_player.token_revoked_at is null
        and request_player.status not in ('cancelled', 'expired')
        and event.cancelled_at is null
        and coalesce(request_player.response_deadline_at, request.occurrence_starts_at) > now()
      ) as can_respond,
      case
        when request.status = 'cancelled' or request_player.status = 'cancelled' or event.cancelled_at is not null then 'This training session has been cancelled.'
        when request_player.token_revoked_at is not null then 'This invitation is no longer valid.'
        when request.status = 'expired' or request_player.status = 'expired' or coalesce(request_player.response_deadline_at, request.occurrence_starts_at) <= now() then 'The response window has closed.'
        else ''
      end::text as lock_reason,
      coalesce(request_player.response_deadline_at, request.occurrence_starts_at) as response_deadline,
      response.responded_at as last_responded_at
    from adult_context context
    join public.training_availability_request_players request_player
      on request_player.club_id = context.club_id
      and request_player.team_id = context.team_id
      and request_player.player_id = context.player_id
      and request_player.parent_link_id is null
      and request_player.recipient_type = 'player'
    join public.training_availability_requests request
      on request.id = request_player.request_id
      and request.club_id = context.club_id
      and request.team_id = context.team_id
    join public.calendar_events event
      on event.id = request.calendar_event_id
      and event.club_id = context.club_id
      and event.team_id = context.team_id
    left join public.training_availability_responses response
      on response.request_player_id = request_player.id
    where request.occurrence_starts_at >= now() - interval '30 days'
  ),
  match_items as (
    select
      concat('match:', request.id)::text as invitation_id,
      'match_attendance'::text as invitation_type,
      request.id as source_record_id,
      match_day.id as event_id,
      'match_day'::text as event_type,
      concat('Match Day vs ', coalesce(nullif(match_day.opponent, ''), 'opponent'))::text as event_title,
      case
        when match_day.match_date is null then null
        else timezone('Europe/London', match_day.match_date + coalesce(match_day.kickoff_time, time '00:00'))
      end as event_start,
      case
        when match_day.match_date is null then null
        else timezone('Europe/London', match_day.match_date + coalesce(match_day.kickoff_time, time '00:00')) + interval '2 hours'
      end as event_end,
      coalesce(nullif(match_day.venue_address, ''), nullif(match_day.venue_name, ''), '')::text as event_location,
      context.team_name,
      coalesce(availability.status, nullif(request.status, 'pending'), 'awaiting_response')::text as response_state,
      coalesce(decision.status, 'undecided')::text as selection_state,
      (
        request.status <> 'expired'
        and request.token_revoked_at is null
        and request.expires_at > now()
        and match_day.status not in ('cancelled', 'postponed', 'full_time')
        and match_day.concluded_at is null
        and match_day.deleted_at is null
      ) as can_respond,
      case
        when match_day.status in ('cancelled', 'postponed') then 'This fixture is not active.'
        when match_day.status = 'full_time' or match_day.concluded_at is not null then 'This fixture has concluded.'
        when match_day.deleted_at is not null then 'This fixture is no longer available.'
        when request.token_revoked_at is not null then 'This invitation is no longer valid.'
        when request.status = 'expired' or request.expires_at <= now() then 'The response deadline has passed.'
        else ''
      end::text as lock_reason,
      request.expires_at as response_deadline,
      coalesce(availability.selected_at, request.responded_at) as last_responded_at
    from adult_context context
    join public.match_day_availability_requests request
      on request.club_id = context.club_id
      and request.team_id = context.team_id
      and request.player_id = context.player_id
      and request.parent_link_id is null
      and request.recipient_type = 'player'
    join public.match_days match_day
      on match_day.id = request.match_day_id
      and match_day.club_id = context.club_id
      and match_day.team_id = context.team_id
    left join public.match_day_player_availability availability
      on availability.match_day_id = match_day.id
      and availability.player_id = context.player_id
    left join public.match_day_player_squad_decisions decision
      on decision.match_day_id = match_day.id
      and decision.player_id = context.player_id
    where match_day.match_date is null
      or match_day.match_date >= timezone('Europe/London', now())::date - 30
  )
  select * from calendar_items
  union all
  select * from training_items
  union all
  select * from match_items
  order by event_start asc nulls last, event_title, invitation_type;
$$;

revoke all on function app_private.adult_player_invitation_state_for_user(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_own_adult_player_invitation_state()
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  event_id uuid,
  event_type text,
  event_title text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  response_state text,
  selection_state text,
  can_respond boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select * from app_private.adult_player_invitation_state_for_user(auth.uid());
$$;

-- Player installations never borrow a Parent link or Parent delivery authority.
create table public.adult_player_mobile_push_installations (
  installation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  adult_link_id uuid not null references public.adult_player_account_links(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  expo_push_token text unique,
  platform text not null check(platform in ('ios','android')),
  detail_level text not null default 'minimal' check(detail_level in ('minimal','detailed')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check(expo_push_token is null or (length(expo_push_token) <= 512 and expo_push_token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$')),
  check(not enabled or expo_push_token is not null)
);
create index adult_player_mobile_push_link_idx on public.adult_player_mobile_push_installations(adult_link_id) where enabled;
alter table public.adult_player_mobile_push_installations enable row level security;
revoke all on public.adult_player_mobile_push_installations from public, anon, authenticated;
grant select, update on public.adult_player_mobile_push_installations to service_role;

-- A native token may retain both roles for the same authenticated person.
-- A different account takes ownership and revokes the previous account.
-- The transaction lock serializes Parent/Player registration of the same token.
create function app_private.fence_shared_parent_player_push_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.expo_push_token is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.expo_push_token, 74012));
  if tg_table_name='adult_player_mobile_push_installations' then
    update public.parent_mobile_push_installations set enabled=false,status='revoked',expo_push_token=null,
      auth_user_id=null,parent_link_id=null,club_id=null,team_id=null,updated_at=now()
      where expo_push_token=new.expo_push_token and auth_user_id is distinct from new.user_id;
  else
    delete from public.adult_player_mobile_push_installations where expo_push_token=new.expo_push_token and user_id is distinct from new.auth_user_id;
  end if;
  return new;
end; $$;
revoke all on function app_private.fence_shared_parent_player_push_token() from public,anon,authenticated,service_role;
create trigger adult_player_shared_push_token before insert or update of expo_push_token on public.adult_player_mobile_push_installations
  for each row execute function app_private.fence_shared_parent_player_push_token();
create trigger parent_shared_player_push_token before insert or update of expo_push_token on public.parent_mobile_push_installations
  for each row execute function app_private.fence_shared_parent_player_push_token();

create function public.own_adult_player_push_installation(action_value text, installation_id_value uuid,
  expected_link_id_value uuid default null, token_value text default null, platform_value text default null,
  detail_value text default 'minimal', enabled_value boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor record; device public.adult_player_mobile_push_installations; detail text;
begin
  if auth.uid() is null then raise exception 'Sign in before changing Player notifications.'; end if;
  if action_value not in ('get','register','update','delete') or installation_id_value is null then raise exception 'Invalid Player notification request.'; end if;
  select * into device from public.adult_player_mobile_push_installations where installation_id = installation_id_value for update;
  if device.user_id is not null and device.user_id <> auth.uid() then raise exception 'PARENT_MOBILE_INSTALLATION_OWNED'; end if;
  -- Sign-out revocation remains possible after a club revokes Player access.
  if action_value = 'delete' then
    delete from public.adult_player_mobile_push_installations where installation_id = installation_id_value and user_id = auth.uid();
    return jsonb_build_object('enabled',false,'registered',false);
  end if;
  select * into actor from app_private.own_adult_player_portal_context();
  if actor.link_id is null or expected_link_id_value is distinct from actor.link_id
    or not public.can_use_plan_feature(actor.club_id, 'parentPortal') then raise exception 'Verified adult Player access is required.'; end if;
  detail := case when detail_value = 'detailed' then 'detailed' else 'minimal' end;
  if action_value = 'register' then
    if platform_value not in ('ios','android') or token_value is null or length(token_value) > 512
      or token_value !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$' then raise exception 'Invalid Player push token.'; end if;
    -- A token cannot retain authority for another Player on this installation.
    delete from public.adult_player_mobile_push_installations where expo_push_token = token_value and installation_id <> installation_id_value;
    insert into public.adult_player_mobile_push_installations(installation_id,user_id,adult_link_id,club_id,team_id,expo_push_token,platform,detail_level,enabled)
      values(installation_id_value,auth.uid(),actor.link_id,actor.club_id,actor.team_id,token_value,platform_value,detail,true)
      on conflict(installation_id) do update set adult_link_id=excluded.adult_link_id,club_id=excluded.club_id,team_id=excluded.team_id,
        expo_push_token=excluded.expo_push_token,platform=excluded.platform,detail_level=excluded.detail_level,enabled=true,updated_at=now()
      where adult_player_mobile_push_installations.user_id=auth.uid()
      returning * into device;
    if device.installation_id is null then raise exception 'PARENT_MOBILE_INSTALLATION_OWNED'; end if;
  elsif action_value = 'update' then
    update public.adult_player_mobile_push_installations set detail_level=detail,enabled=enabled_value,updated_at=now()
      where installation_id=installation_id_value and user_id=auth.uid() and adult_link_id=actor.link_id
        and club_id=actor.club_id and team_id=actor.team_id and (not enabled_value or expo_push_token is not null)
      returning * into device;
    if device.installation_id is null then raise exception 'Enable Player notifications on this device first.'; end if;
  end if;
  return jsonb_build_object('enabled',coalesce(device.enabled,false) and device.adult_link_id=actor.link_id and device.team_id=actor.team_id,
    'registered',device.expo_push_token is not null and device.adult_link_id=actor.link_id and device.team_id=actor.team_id,
    'detailLevel',coalesce(device.detail_level,detail),'platform',device.platform);
end; $$;
revoke all on function public.own_adult_player_push_installation(text,uuid,uuid,text,text,text,boolean) from public,anon;
grant execute on function public.own_adult_player_push_installation(text,uuid,uuid,text,text,text,boolean) to authenticated;

create table public.adult_player_mobile_push_intents (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.adult_player_mobile_push_installations(installation_id) on delete cascade,
  kind text not null check(kind in ('chat','invitation')),
  source_id text not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(installation_id,kind,source_id)
);
create index adult_player_push_intents_due_idx on public.adult_player_mobile_push_intents(available_at,id) where status in ('pending','failed','processing');
alter table public.adult_player_mobile_push_intents enable row level security;
revoke all on public.adult_player_mobile_push_intents from public,anon,authenticated;
grant select,update on public.adult_player_mobile_push_intents to service_role;

create function app_private.enqueue_adult_player_mobile_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare item jsonb := to_jsonb(new); source text; target_player uuid; target_team uuid; target_club uuid;
begin
  if tg_table_name = 'parent_chat_messages' then
    if new.deleted_at is not null then return new; end if;
    insert into public.adult_player_mobile_push_intents(installation_id,kind,source_id)
      select device.installation_id,'chat',new.id::text
      from public.adult_player_mobile_push_installations device
      join public.parent_chat_rooms room on room.id=new.room_id and room.club_id=device.club_id and room.team_id=device.team_id
      where device.enabled and device.expo_push_token is not null and device.user_id is distinct from new.sender_id
      on conflict do nothing;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Responses and subsequent bookkeeping must never resend an invitation.
    if tg_table_name = 'calendar_event_invites' then
      if (new.invite_status is not distinct from old.invite_status and new.notify_requested is not distinct from old.notify_requested) or new.invite_status <> 'active' then return new; end if;
    else
      if new.status is not distinct from old.status or new.status not in ('pending','sent') then return new; end if;
    end if;
  end if;
  if tg_table_name = 'calendar_event_invites' then
    if item->>'recipient_type' not in ('player','parent_and_player') or item->>'invite_status' <> 'active' or item->>'notify_requested' <> 'true' then return new; end if;
    source := 'calendar:' || new.id;
  else
    if item->>'recipient_type' <> 'player' or item->>'parent_link_id' is not null or item->>'status' not in ('pending','sent') then return new; end if;
    source := case when tg_table_name='training_availability_request_players' then 'training:' else 'match:' end || new.id;
  end if;
  target_player := (item->>'player_id')::uuid; target_team := (item->>'team_id')::uuid; target_club := (item->>'club_id')::uuid;
  insert into public.adult_player_mobile_push_intents(installation_id,kind,source_id)
    select device.installation_id,'invitation',source
    from public.adult_player_mobile_push_installations device
    join public.adult_player_account_links link on link.id=device.adult_link_id and link.user_id=device.user_id and link.player_id=target_player
    where device.club_id=target_club and device.team_id=target_team and device.enabled and device.expo_push_token is not null
    on conflict do nothing;
  return new;
end; $$;
revoke all on function app_private.enqueue_adult_player_mobile_push() from public,anon,authenticated,service_role;
create trigger adult_player_chat_push after insert on public.parent_chat_messages for each row execute function app_private.enqueue_adult_player_mobile_push();
create trigger adult_player_calendar_push after insert or update of invite_status,notify_requested on public.calendar_event_invites for each row execute function app_private.enqueue_adult_player_mobile_push();
create trigger adult_player_training_push after insert or update of status on public.training_availability_request_players for each row execute function app_private.enqueue_adult_player_mobile_push();
create trigger adult_player_match_push after insert or update of status on public.match_day_availability_requests for each row execute function app_private.enqueue_adult_player_mobile_push();

-- This private worker helper evaluates shared checks for the installation user.
-- It never changes JWT claims, identity, roles or configuration privileges.
-- Only the service-only claim function below can invoke it.
create function app_private.adult_player_push_payload(device public.adult_player_mobile_push_installations, kind_value text, source_value text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor record; message_row record; invitation record; data_value jsonb; title_value text; body_value text;
begin
  select * into actor from app_private.adult_player_portal_context_for_user(device.user_id);
  if actor.link_id is distinct from device.adult_link_id or actor.club_id is distinct from device.club_id or actor.team_id is distinct from device.team_id
    or not device.enabled or device.expo_push_token is null or not public.can_use_plan_feature(device.club_id,'parentPortal') then return null; end if;
  if kind_value = 'chat' then
    select message.*,room.team_id into message_row from public.parent_chat_messages message
      join public.parent_chat_rooms room on room.id=message.room_id
      where message.id=source_value::uuid and message.deleted_at is null and message.sender_id is distinct from device.user_id
        and message.created_at >= actor.history_cutoff;
    if message_row.id is null or not app_private.adult_player_chat_can_access_for_user(device.user_id,message_row.room_id)
      or exists(select 1 from public.adult_player_chat_preferences preference where preference.adult_link_id=device.adult_link_id
        and preference.room_id=message_row.room_id and (preference.notifications_muted or preference.last_read_at >= message_row.created_at)) then return null; end if;
    title_value := 'Football Player Chat'; body_value := 'A new Chat update is available.';
    data_value := jsonb_build_object('route','chat','roomId',message_row.room_id,'messageId',message_row.id,'type','player_chat');
  else
    if source_value like 'calendar:%' and not exists(select 1 from public.calendar_event_invites invite where invite.id=split_part(source_value,':',2)::uuid and invite.notify_requested) then return null; end if;
    select * into invitation from app_private.adult_player_invitation_state_for_user(device.user_id) where invitation_id=source_value;
    if invitation.invitation_id is null or invitation.event_start <= now()
      or (invitation.invitation_type <> 'calendar_information' and not invitation.can_respond)
      or (invitation.invitation_type = 'calendar_information' and invitation.lock_reason <> 'This event is for information. No response is required.')
      or not public.can_use_plan_feature(device.club_id,case when invitation.invitation_type='match_attendance' then 'matchDay' else 'teamCalendar' end) then return null; end if;
    title_value := 'Football Player Invitation'; body_value := 'A new invitation is ready to view.';
    data_value := jsonb_build_object('route','invites','invitationId',source_value,'type','player_invitation');
  end if;
  return jsonb_build_object('to',device.expo_push_token,'title',title_value,'body',body_value,'sound','default',
    'data',data_value || jsonb_build_object('app','player','userId',device.user_id,'adultLinkId',device.adult_link_id,'teamId',device.team_id,'clubId',device.club_id));
end; $$;
revoke all on function app_private.adult_player_push_payload(public.adult_player_mobile_push_installations,text,text) from public,anon,authenticated,service_role;

create function public.claim_adult_player_mobile_push_intents(batch_size_value integer default 50)
returns table(intent_id bigint,installation_id uuid,payload jsonb)
language plpgsql security definer set search_path = '' as $$
declare candidate record; device public.adult_player_mobile_push_installations; result jsonb;
begin
  for candidate in select intent.* from public.adult_player_mobile_push_intents intent
    where intent.attempts < 5 and intent.created_at > now()-interval '1 day' and intent.available_at <= now()
      and (intent.status in ('pending','failed') or (intent.status='processing' and intent.locked_at < now()-interval '5 minutes'))
    order by intent.id for update skip locked limit greatest(1,least(coalesce(batch_size_value,50),100))
  loop
    select * into device from public.adult_player_mobile_push_installations where adult_player_mobile_push_installations.installation_id=candidate.installation_id;
    result := app_private.adult_player_push_payload(device,candidate.kind,candidate.source_id);
    update public.adult_player_mobile_push_intents set status=case when result is null then 'skipped' else 'processing' end,
      attempts=attempts+1,locked_at=case when result is null then null else now() end where id=candidate.id;
    if result is not null then intent_id:=candidate.id; installation_id:=candidate.installation_id; payload:=result; return next; end if;
  end loop;
end; $$;
revoke all on function public.claim_adult_player_mobile_push_intents(integer) from public,anon,authenticated;
grant execute on function public.claim_adult_player_mobile_push_intents(integer) to service_role;
