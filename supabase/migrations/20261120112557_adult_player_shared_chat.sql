-- Explicit Player actor endpoints. Parent and staff authority stays unchanged.
-- Read cursors and preferences belong to the verified adult link, never a Parent.
alter table public.parent_chat_rooms drop constraint parent_chat_rooms_type_check;
alter table public.parent_chat_rooms add constraint parent_chat_rooms_type_check
  check (room_type in ('parent_staff', 'player_staff', 'team', 'team_training', 'team_match', 'match_squad'));
alter table public.parent_chat_rooms drop constraint parent_chat_rooms_scope_check;
alter table public.parent_chat_rooms add constraint parent_chat_rooms_scope_check check (
  (room_type in ('parent_staff', 'player_staff') and player_id is not null and match_day_id is null)
  or (room_type in ('team', 'team_training', 'team_match') and player_id is null and match_day_id is null)
  or (room_type = 'match_squad' and player_id is null and match_day_id is not null)
);
create unique index parent_chat_rooms_player_staff_key on public.parent_chat_rooms(club_id, team_id, player_id)
  where room_type = 'player_staff';
-- Existing Coach notification fanout carries the room type into its outbox.
alter table public.parent_chat_mobile_notification_intents
  drop constraint parent_chat_mobile_notification_intents_room_type_check;
alter table public.parent_chat_mobile_notification_intents
  add constraint parent_chat_mobile_notification_intents_room_type_check
  check (room_type in ('parent_staff', 'player_staff', 'team', 'team_training', 'team_match', 'match_squad'));

create table public.adult_player_chat_preferences (
  adult_link_id uuid not null references public.adult_player_account_links(id) on delete cascade,
  room_id uuid not null references public.parent_chat_rooms(id) on delete cascade,
  last_read_at timestamptz,
  notifications_muted boolean not null default false,
  primary key (adult_link_id, room_id)
);
alter table public.adult_player_chat_preferences enable row level security;
revoke all on public.adult_player_chat_preferences from public, anon, authenticated;

alter table public.parent_chat_messages drop constraint parent_chat_messages_sender_kind_check;
alter table public.parent_chat_messages add constraint parent_chat_messages_sender_kind_check
  check (sender_kind in ('parent', 'staff', 'player'));

create or replace function app_private.own_adult_player_portal_context()
returns table (link_id uuid, user_id uuid, player_id uuid, club_id uuid, team_id uuid,
  player_name text, history_cutoff timestamptz, email text)
language sql stable security definer set search_path = '' as $$
  select state.link_id, state.user_id, state.player_id, state.club_id, state.team_id,
    state.player_name, date_trunc('day', link.created_at), lower(btrim(account.email))
  from public.get_own_adult_player_account_state() state
  join public.adult_player_account_links link on link.id = state.link_id and link.user_id = auth.uid()
  join auth.users account on account.id = state.user_id
  join public.players player on player.id = state.player_id and player.club_id = state.club_id and player.team_id = state.team_id
  join public.clubs club on club.id = state.club_id and club.status = 'active' and club.archived_at is null
  join public.teams team on team.id = state.team_id and team.club_id = club.id and team.status = 'active' and team.archived_at is null
  where state.access_granted and state.access_mode = 'player' and state.user_id = auth.uid()
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
revoke all on function app_private.own_adult_player_portal_context() from public, anon, authenticated, service_role;

create or replace function app_private.own_adult_player_chat_context()
returns table (link_id uuid, user_id uuid, player_id uuid, club_id uuid, team_id uuid,
  player_name text, history_cutoff timestamptz, community_type text)
language sql stable security definer set search_path = '' as $$
  select state.link_id, state.user_id, state.player_id, state.club_id, state.team_id,
    state.player_name, state.history_cutoff,
    case player_type.chat_group when 'team' then 'team' when 'training' then 'team_training'
      when 'match' then 'team_match' else '' end
  from app_private.own_adult_player_portal_context() state
  join public.players player on player.id = state.player_id
  left join public.club_player_types player_type
    on player_type.club_id = state.club_id and player_type.name = player.section
  where public.can_use_plan_feature(state.club_id, 'parentChat');
$$;

create or replace function app_private.own_adult_player_chat_can_access(target_room_id uuid, for_post boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.own_adult_player_chat_context() actor
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
revoke all on function app_private.own_adult_player_chat_context() from public, anon, authenticated, service_role;
revoke all on function app_private.own_adult_player_chat_can_access(uuid, boolean) from public, anon, authenticated, service_role;

-- Explicit preparation is separate from inbox reads and touches only own scope.
create or replace function public.prepare_own_adult_player_chat()
returns void language plpgsql security definer set search_path = '' as $$
declare actor record;
begin
  select * into actor from app_private.own_adult_player_chat_context();
  if actor.link_id is null then raise exception 'Verified adult Player access is required.'; end if;
  insert into public.parent_chat_rooms(club_id, team_id, player_id, room_type, title)
    values(actor.club_id, actor.team_id, actor.player_id, 'player_staff', 'Chat with Staff')
    on conflict (club_id, team_id, player_id) where room_type = 'player_staff' do nothing;
  if actor.community_type <> '' then
    insert into public.parent_chat_rooms(club_id, team_id, room_type, title)
      values(actor.club_id, actor.team_id, actor.community_type,
        case actor.community_type when 'team_training' then 'Training Chat'
          when 'team_match' then 'Match Community Chat' else 'Team Chat' end)
      on conflict do nothing;
  end if;
  insert into public.parent_chat_rooms(club_id, team_id, match_day_id, room_type, title, status)
    select actor.club_id, actor.team_id, fixture.id, 'match_squad', 'Match Squad Chat',
      case when fixture.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active' else 'closed' end
    from public.match_days fixture
    join public.match_day_player_squad_decisions decision on decision.match_day_id = fixture.id
      and decision.club_id = actor.club_id and decision.team_id = actor.team_id
      and decision.player_id = actor.player_id and decision.status = 'selected'
    where fixture.club_id = actor.club_id and fixture.team_id = actor.team_id
      and fixture.deleted_at is null and fixture.previous_hidden_at is null
    on conflict do nothing;
end;
$$;

create or replace function public.get_own_adult_player_chat_rooms()
returns table(id uuid, room_type text, status text, title text, club_id uuid, club_name text,
  team_id uuid, team_name text, player_id uuid, player_name text, match_day_id uuid,
  opponent text, match_date date, kickoff_time time, kickoff_time_tbc boolean, meet_time time,
  venue_name text, fixture_status text, child_names text[], latest_message text,
  latest_message_at timestamptz, unread_count bigint, can_post boolean, notifications_muted boolean)
language sql stable security definer set search_path = '' as $$
  select room.id, room.room_type, room.status, room.title, room.club_id, club.name,
    room.team_id, team.name, room.player_id, case when room.player_id is not null then actor.player_name end,
    room.match_day_id, fixture.opponent, fixture.match_date, fixture.kickoff_time,
    coalesce(fixture.kickoff_time_tbc, false), fixture.arrival_time, fixture.venue_name, fixture.status,
    array[actor.player_name]::text[], coalesce(latest.body, ''), latest.created_at,
    (select count(*) from public.parent_chat_messages message
      where message.room_id = room.id and message.deleted_at is null and message.sender_id <> actor.user_id
        and message.created_at >= actor.history_cutoff
        and message.created_at > coalesce(preference.last_read_at, '-infinity'::timestamptz)),
    app_private.own_adult_player_chat_can_access(room.id, true), coalesce(preference.notifications_muted, false)
  from app_private.own_adult_player_chat_context() actor
  join public.parent_chat_rooms room on room.club_id = actor.club_id and room.team_id = actor.team_id
  join public.clubs club on club.id = room.club_id
  join public.teams team on team.id = room.team_id
  left join public.match_days fixture on fixture.id = room.match_day_id
  left join public.adult_player_chat_preferences preference on preference.adult_link_id = actor.link_id and preference.room_id = room.id
  left join lateral (select message.body, message.created_at from public.parent_chat_messages message
    where message.room_id = room.id and message.deleted_at is null and message.created_at >= actor.history_cutoff
    order by message.created_at desc, message.id desc limit 1) latest on true
  where app_private.own_adult_player_chat_can_access(room.id)
  order by latest.created_at desc nulls last, room.id;
$$;

create or replace function public.get_own_adult_player_chat_messages(target_room_id uuid)
returns table(id uuid, room_id uuid, sender_id uuid, sender_kind text, sender_name text,
  sender_role text, body text, deleted_at timestamptz, created_at timestamptz, updated_at timestamptz, can_delete boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.own_adult_player_chat_can_access(target_room_id) then
    raise exception 'This Chat room is not available for this Player.';
  end if;
  return query select message.id, message.room_id, message.sender_id, message.sender_kind,
    message.sender_name, message.sender_role, case when message.deleted_at is null then message.body else '' end,
    message.deleted_at, message.created_at, message.updated_at,
    message.sender_id = actor.user_id and message.sender_kind = 'player'
  from app_private.own_adult_player_chat_context() actor
  join public.parent_chat_messages message on message.room_id = target_room_id
    and message.created_at >= actor.history_cutoff
  order by message.created_at, message.id;
end;
$$;

create or replace function public.mark_own_adult_player_chat_room_read(target_room_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare actor record; read_at timestamptz := statement_timestamp();
begin
  if not app_private.own_adult_player_chat_can_access(target_room_id) then
    raise exception 'This Chat room is not available for this Player.';
  end if;
  select * into actor from app_private.own_adult_player_chat_context();
  insert into public.adult_player_chat_preferences(adult_link_id, room_id, last_read_at)
    values(actor.link_id, target_room_id, read_at)
    on conflict(adult_link_id, room_id) do update set last_read_at = greatest(adult_player_chat_preferences.last_read_at, excluded.last_read_at);
  return read_at;
end;
$$;

create or replace function public.set_own_adult_player_chat_notification_preference(target_room_id uuid, notifications_muted_value boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor record;
begin
  if not app_private.own_adult_player_chat_can_access(target_room_id) then
    raise exception 'This Chat room is not available for this Player.';
  end if;
  select * into actor from app_private.own_adult_player_chat_context();
  insert into public.adult_player_chat_preferences(adult_link_id, room_id, notifications_muted)
    values(actor.link_id, target_room_id, coalesce(notifications_muted_value, false))
    on conflict(adult_link_id, room_id) do update set notifications_muted = excluded.notifications_muted;
  return coalesce(notifications_muted_value, false);
end;
$$;

create or replace function public.send_own_adult_player_chat_message(target_room_id uuid, body_value text, client_request_id_value uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor record; existing public.parent_chat_messages%rowtype; message_id uuid;
  normalized_body text := btrim(coalesce(body_value, '')); request_id uuid := coalesce(client_request_id_value, gen_random_uuid());
begin
  if not app_private.own_adult_player_chat_can_access(target_room_id, true) then
    raise exception 'This Chat room is not available for new messages.';
  end if;
  if char_length(normalized_body) not between 1 and 2000 then raise exception 'Chat messages must contain between 1 and 2000 characters.'; end if;
  select * into actor from app_private.own_adult_player_chat_context();
  insert into public.parent_chat_messages(room_id, club_id, sender_id, sender_kind, sender_name, sender_role, body, client_request_id)
    values(target_room_id, actor.club_id, actor.user_id, 'player', actor.player_name, 'Player', normalized_body, request_id)
    on conflict(sender_id, client_request_id) where client_request_id is not null do nothing returning id into message_id;
  if message_id is null then
    select message.* into existing from public.parent_chat_messages message
      where message.sender_id = actor.user_id and message.client_request_id = request_id;
    if existing.room_id is distinct from target_room_id or existing.body is distinct from normalized_body or existing.sender_kind <> 'player' then
      raise exception 'This Chat request identity has already been used.';
    end if;
    return existing.id;
  end if;
  update public.parent_chat_rooms set updated_at = statement_timestamp() where id = target_room_id;
  perform public.mark_own_adult_player_chat_room_read(target_room_id);
  return message_id;
end;
$$;

create or replace function public.delete_own_adult_player_chat_message(target_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.parent_chat_messages%rowtype; actor record;
begin
  select message.* into target from public.parent_chat_messages message where message.id = target_message_id;
  if target.id is null or not app_private.own_adult_player_chat_can_access(target.room_id) then
    raise exception 'This Chat message is not available for this Player.';
  end if;
  select * into actor from app_private.own_adult_player_chat_context();
  if target.sender_id <> actor.user_id or target.sender_kind <> 'player' or target.created_at < actor.history_cutoff then
    raise exception 'Only your own Player messages can be deleted.';
  end if;
  update public.parent_chat_messages set deleted_at = coalesce(deleted_at, statement_timestamp()),
    deleted_by = actor.user_id, updated_at = statement_timestamp() where id = target.id;
end;
$$;

revoke all on function public.prepare_own_adult_player_chat() from public, anon;
revoke all on function public.get_own_adult_player_chat_rooms() from public, anon;
revoke all on function public.get_own_adult_player_chat_messages(uuid) from public, anon;
revoke all on function public.send_own_adult_player_chat_message(uuid, text, uuid) from public, anon;
revoke all on function public.mark_own_adult_player_chat_room_read(uuid) from public, anon;
revoke all on function public.set_own_adult_player_chat_notification_preference(uuid, boolean) from public, anon;
revoke all on function public.delete_own_adult_player_chat_message(uuid) from public, anon;
grant execute on function public.prepare_own_adult_player_chat() to authenticated, service_role;
grant execute on function public.get_own_adult_player_chat_rooms() to authenticated, service_role;
grant execute on function public.get_own_adult_player_chat_messages(uuid) to authenticated, service_role;
grant execute on function public.send_own_adult_player_chat_message(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.mark_own_adult_player_chat_room_read(uuid) to authenticated, service_role;
grant execute on function public.set_own_adult_player_chat_notification_preference(uuid, boolean) to authenticated, service_role;
grant execute on function public.delete_own_adult_player_chat_message(uuid) to authenticated, service_role;

-- Separate the Player identity from legacy account/email receipts. Existing
-- Parent and staff vote queries and their conflict target retain the same semantics.
alter table public.poll_votes add column adult_player_link_id uuid
  references public.adult_player_account_links(id) on delete cascade;
alter table public.poll_votes alter column voter_email drop not null;
alter table public.poll_votes add constraint poll_votes_receipt_identity_check check (
  (adult_player_link_id is null and voter_email is not null)
  or (adult_player_link_id is not null and voter_email is null and auth_user_id is null and parent_link_id is null)
);
create unique index poll_votes_adult_player_link_poll_option_key
  on public.poll_votes(adult_player_link_id, poll_id, option_id)
  where adult_player_link_id is not null;

-- Team polls use the existing family-facing audience for verified Players.
create function public.get_own_adult_player_polls()
returns table (
  id uuid, club_id uuid, team_id uuid, title text, description text,
  poll_type text, options jsonb, status text, closes_at timestamptz,
  allow_multiple boolean, max_choices integer, allow_own_child_votes boolean,
  allow_vote_changes boolean, created_at timestamptz, current_option_ids jsonb,
  votes jsonb, requires_watched_match boolean
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.club_id, p.team_id, p.title, p.description, p.poll_type, p.options,
    p.status, p.closes_at, p.allow_multiple, p.max_choices, p.allow_own_child_votes,
    p.allow_vote_changes, p.created_at, mine.options,
    case when p.hide_votes and p.status = 'open' and (p.closes_at is null or p.closes_at > now())
      and mine.options = '[]'::jsonb then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object('optionId', tally.option_id, 'count', tally.total) order by tally.option_id)
        from (select v.option_id, count(*) as total from public.poll_votes v where v.poll_id = p.id group by v.option_id) tally
      ), '[]'::jsonb)
    end,
    (exists (select 1 from public.match_days m where m.motm_poll_id = p.id and m.club_id = p.club_id)
      or (p.poll_type = 'awards' and btrim(p.title) ~* '^(player|man) of the match([ :]|$)'))
  from app_private.own_adult_player_portal_context() a
  join public.polls p on p.club_id = a.club_id and (p.team_id is null or p.team_id = a.team_id)
    and p.audience = 'parents' and p.created_at >= a.history_cutoff
  cross join lateral (
    select coalesce(jsonb_agg(v.option_id order by v.option_id), '[]'::jsonb) options
    from public.poll_votes v
    where v.poll_id = p.id and v.adult_player_link_id = a.link_id
  ) mine
  where public.can_use_plan_feature(a.club_id, 'teamPolls')
  order by case when p.status = 'open' and (p.closes_at is null or p.closes_at > now()) then 0 else 1 end,
    p.created_at desc;
$$;

create function public.submit_own_adult_player_poll_vote(
  poll_id_value uuid, option_id_value text, watched_match_value boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor record;
  poll public.polls%rowtype;
  selected_option_id text := btrim(coalesce(option_id_value, ''));
  selected jsonb;
  existing_id uuid;
  vote_count integer;
  result_id uuid;
  audit_action text := 'adult_player_poll_vote_submitted';
begin
  select * into actor from app_private.own_adult_player_portal_context();
  if actor.link_id is null or not coalesce(public.can_use_plan_feature(actor.club_id, 'teamPolls'), false) then
    raise exception using errcode = '42501', message = 'Player poll access is unavailable.';
  end if;

  select p.* into poll from public.polls p
  where p.id = poll_id_value and p.club_id = actor.club_id and (p.team_id is null or p.team_id = actor.team_id)
    and p.audience = 'parents' and p.created_at >= actor.history_cutoff and p.status = 'open'
    and (p.closes_at is null or p.closes_at > now())
  for update;
  if poll.id is null then
    raise exception using errcode = '42501', message = 'This Player poll is unavailable or closed.';
  end if;

  if (exists (select 1 from public.match_days m where m.motm_poll_id = poll.id and m.club_id = poll.club_id)
    or (poll.poll_type = 'awards' and btrim(poll.title) ~* '^(player|man) of the match([ :]|$)'))
    and watched_match_value is distinct from true then
    raise exception using errcode = '22023', message = 'Confirm that you watched the match before voting.';
  end if;

  select item into selected from jsonb_array_elements(poll.options) item where item->>'id' = selected_option_id limit 1;
  if selected is null or selected_option_id = '' or length(selected_option_id) > 80 then
    raise exception using errcode = '22023', message = 'Choose a valid poll answer.';
  end if;
  if poll.allow_own_child_votes is false and lower(coalesce(selected->>'playerId', selected->>'player_id')) = actor.player_id::text then
    raise exception using errcode = '42501', message = 'You cannot vote for yourself in this poll.';
  end if;

  select v.id into existing_id from public.poll_votes v
  where v.poll_id = poll.id and v.option_id = selected_option_id
    and v.adult_player_link_id = actor.link_id
  limit 1;
  if existing_id is not null then
    if poll.allow_multiple and poll.allow_vote_changes then
      delete from public.poll_votes where id = existing_id;
      result_id := existing_id;
      audit_action := 'adult_player_poll_vote_removed';
    else
      return existing_id;
    end if;
  else
    select count(*) into vote_count from public.poll_votes v
    where v.poll_id = poll.id
      and v.adult_player_link_id = actor.link_id;
    if not poll.allow_multiple and vote_count > 0 and not poll.allow_vote_changes then
      raise exception using errcode = '55000', message = 'Your answer is locked for this poll.';
    end if;
    if poll.allow_multiple and poll.max_choices is not null and vote_count >= poll.max_choices then
      raise exception using errcode = '55000', message = 'You have reached the maximum choices for this poll.';
    end if;
    if not poll.allow_multiple then
      delete from public.poll_votes v where v.poll_id = poll.id
        and v.adult_player_link_id = actor.link_id;
    end if;
    insert into public.poll_votes(poll_id, club_id, team_id, voter_name, option_id, adult_player_link_id)
    values(poll.id, poll.club_id, poll.team_id, actor.player_name, selected_option_id, actor.link_id)
    returning id into result_id;
  end if;

  insert into public.audit_logs(club_id, actor_id, action, entity_type, entity_id, metadata)
  values(poll.club_id, (select u.id from public.users u where u.id = actor.user_id), audit_action, 'poll', poll.id,
    jsonb_build_object('actorAuthUserId', actor.user_id, 'adultPlayerLinkId', actor.link_id,
      'optionId', selected_option_id, 'watchedMatch', watched_match_value is true));
  return result_id;
end;
$$;

revoke all on function public.get_own_adult_player_polls() from public, anon, service_role;
revoke all on function public.submit_own_adult_player_poll_vote(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.get_own_adult_player_polls() to authenticated;
grant execute on function public.submit_own_adult_player_poll_vote(uuid, text, boolean) to authenticated;
