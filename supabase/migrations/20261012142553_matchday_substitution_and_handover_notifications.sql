-- Substitutions use active eligible team players independently of squad confirmation.
-- Other event participant rules and all actor checks remain authoritative.
create or replace function private.match_day_substitution_participants(match_id uuid)
returns table(id uuid, player_name text, shirt_number text, team_id uuid)
language sql stable security definer set search_path = '' as $function$
  select p.id,p.player_name,coalesce(p.shirt_number,''),p.team_id
  from public.match_days f join public.players p on p.club_id=f.club_id and p.team_id=f.team_id
  where f.id=match_id and f.deleted_at is null
    and p.archived_at is null and coalesce(p.status,'active')='active'
    and (p.section='Squad' or (p.section='Trial' and public.can_use_plan_feature(f.club_id,'trialPlayers')))
    and nullif(trim(p.player_name),'') is not null
  order by lower(p.player_name),p.id;
$function$;
revoke all on function private.match_day_substitution_participants(uuid) from public,anon,authenticated;

create or replace function private.match_day_event_type_participants(match_id uuid, event_type text)
returns table(id uuid, player_name text, shirt_number text, team_id uuid)
language sql stable security definer set search_path = '' as $function$
  select * from private.match_day_substitution_participants(match_id) where event_type='substitution'
  union all
  select * from private.match_day_event_participants(match_id) where event_type is distinct from 'substitution';
$function$;
revoke all on function private.match_day_event_type_participants(uuid,text) from public,anon,authenticated;

create or replace function public.get_match_day_event_participants(match_day_id_value uuid, parent_link_id_value uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare m public.match_days%rowtype;
begin
  select * into m from public.match_days where id=match_day_id_value;
  if auth.uid() is null or m.id is null or m.team_id is null or m.deleted_at is not null
    or m.concluded_at is not null or m.status in ('cancelled','postponed')
    or not coalesce(public.match_day_local_date_is_today(m.id),false)
    or not coalesce(public.can_use_plan_feature(m.club_id,'fixtures'),false) or not coalesce(public.can_use_plan_feature(m.club_id,'players'),false)
    then raise exception 'Current Match Day access is required.'; end if;
  if parent_link_id_value is not null then
    if not coalesce(public.current_user_is_match_day_scorer(m.id),false) or not exists(
      select 1 from public.match_day_role_assignments a join public.parent_player_links l on l.id=a.parent_link_id
      where a.match_day_id=m.id and a.role='scorer' and a.parent_link_id=parent_link_id_value
        and a.club_id=m.club_id and a.team_id=m.team_id and l.club_id=m.club_id and l.team_id=m.team_id
        and a.auth_user_id=auth.uid() and l.auth_user_id=a.auth_user_id and l.status='active')
    then raise exception 'Current selected Parent scorer access is required.'; end if;
  elsif not coalesce(public.can_manage_match_day(m.team_id),false) or public.current_user_club_id() is distinct from m.club_id then
    raise exception 'Current team staff access is required.';
  end if;
  return jsonb_build_object('matchId',m.id,'teamId',m.team_id,'players',
    (select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from private.match_day_event_participants(m.id) p),
    'substitutionPlayers',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from private.match_day_substitution_participants(m.id) p),
    'eventIdentities',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,
      'scorer_player_id',e.scorer_player_id,'assist_player_id',e.assist_player_id,
      'participant_identity_version',e.participant_identity_version)),'[]'::jsonb)
      from public.match_day_events e where e.match_day_id=m.id and e.club_id=m.club_id and e.team_id=m.team_id));
end;
$function$;
CREATE OR REPLACE FUNCTION public.record_match_day_scorer_event_v2(match_day_id_value uuid, event_type_value text, team_side_value text, minute_value integer, player_name_value text, player_shirt_number_value text, player_on_name_value text, player_on_shirt_number_value text, notes_value text, request_id_value uuid, parent_link_id_value uuid DEFAULT NULL, stoppage_minute_value integer DEFAULT NULL, player_id_value uuid DEFAULT NULL, player_on_id_value uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  match_row public.match_days%rowtype;
  actor_record record;
  normalized_event_type text := trim(coalesce(event_type_value, ''));
  normalized_team_side text := trim(coalesce(team_side_value, 'club'));
  normalized_player_name text := trim(coalesce(player_name_value, ''));
  normalized_player_shirt text := trim(coalesce(player_shirt_number_value, ''));
  normalized_player_on_name text := trim(coalesce(player_on_name_value, ''));
  normalized_player_on_shirt text := trim(coalesce(player_on_shirt_number_value, ''));
  participant_player_id uuid;
  participant_player_on_id uuid;
  participant_match_count integer := 0;
  participant_on_match_count integer := 0;
  event_row public.match_day_events%rowtype;
  coach_named_participant boolean := false;
  named_off boolean := false;
  named_on boolean := false;
begin
  if auth.uid() is null and not private.is_guest_match_scorer(match_day_id_value) then
    raise exception 'Login is required before adding a match event.';
  end if;

  if request_id_value is null then
    raise exception 'A request id is required before adding a match event.';
  end if;

  if normalized_event_type not in ('yellow_card', 'red_card', 'substitution', 'water_break') then
    raise exception 'Choose a supported Match Day event type.';
  end if;

  if normalized_team_side not in ('club', 'opponent') then
    raise exception 'Choose which team the event belongs to.';
  end if;

  if minute_value is null or minute_value < 0 or minute_value > 999 then
    raise exception 'Choose a whole match minute from 0 to 999.';
  end if;

  if stoppage_minute_value is not null and (stoppage_minute_value < 0 or stoppage_minute_value > 30) then
    raise exception 'Added time must be between 0 and 30 minutes.';
  end if;
  if length(normalized_player_name)>80 or length(normalized_player_on_name)>80
    or length(normalized_player_shirt)>8 or length(normalized_player_on_shirt)>8
    or length(coalesce(notes_value,''))>500 then
    raise exception 'Match event details are too long.';
  end if;

  select * into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    or coalesce(match_row.timer_status, 'not_started') in ('not_started', 'full_time') then
    raise exception 'Start or resume the match before recording an event.';
  end if;

  select * into actor_record from public.resolve_match_day_mutation_actor(match_row.id, parent_link_id_value);
  if actor_record.actor_user_id is null and actor_record.actor_role is distinct from 'scorer_guest' then
    raise exception 'Only a coach or the selected scorer can add events for this match.';
  end if;

  perform public.get_match_day_event_participants(match_row.id,parent_link_id_value);
  select * into event_row
  from public.match_day_events
  where match_day_id = match_day_id_value
    and request_id = request_id_value;

  if event_row.id is not null then
    if event_row.scorer_player_id is distinct from player_id_value or event_row.assist_player_id is distinct from player_on_id_value or event_row.event_type<>normalized_event_type or event_row.team_side<>normalized_team_side
      or event_row.minute is distinct from minute_value
      or coalesce(event_row.stoppage_minute,0)<>coalesce(stoppage_minute_value,0)
      or event_row.scorer_name<>normalized_player_name or event_row.scorer_shirt_number<>normalized_player_shirt
      or event_row.assist_name<>(case when normalized_event_type='substitution' then normalized_player_on_name else '' end)
      or event_row.assist_shirt_number<>(case when normalized_event_type='substitution' then normalized_player_on_shirt else '' end)
      or event_row.notes<>trim(coalesce(notes_value,'')) then
      raise exception 'This request has already been used for a different change.';
    end if;
    return to_jsonb(event_row);
  end if;

  -- Only an authorised Coach may use explicitly labelled match-only participants.
  -- Parent and guest scorers retain server-verified participant validation.
  coach_named_participant := auth.uid() is not null
    and coalesce(public.can_manage_match_day(match_row.team_id), false)
    and actor_record.actor_parent_link_id is null
    and actor_record.actor_role is distinct from 'scorer_guest';
  named_off := coach_named_participant and normalized_player_shirt = '' and
    (normalized_player_name ~ '^Other: [^[:space:]].*' or
      (normalized_event_type in ('yellow_card', 'red_card') and normalized_player_name ~ '^Coach: [^[:space:]].*'));
  named_on := coach_named_participant and normalized_player_on_shirt = ''
    and normalized_player_on_name ~ '^Other: [^[:space:]].*';

  if normalized_team_side = 'club' and normalized_event_type <> 'water_break' then
    if normalized_player_name = '' then
      raise exception 'Choose a eligible Match Player before recording this event.';
    end if;

    if not named_off then
      select count(*), min(player.id::text)::uuid
      into participant_match_count, participant_player_id
      from private.match_day_event_type_participants(match_row.id,normalized_event_type) player
      where true
        and player.id=player_id_value
        and lower(trim(player.player_name)) = lower(normalized_player_name)
        and (normalized_player_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_shirt);

      if participant_match_count <> 1 or participant_player_id is null then
        raise exception 'Choose one eligible Match Player from this fixture Team.' using errcode = '22023';
      end if;

    end if;

    if normalized_event_type = 'substitution' then
      if normalized_player_on_name = '' then
        raise exception 'Choose a eligible Match Player On before recording this substitution.';
      end if;

      if not named_on then
        select count(*), min(player.id::text)::uuid
        into participant_on_match_count, participant_player_on_id
        from private.match_day_event_type_participants(match_row.id,normalized_event_type) player
      where true
          and player.id=player_on_id_value
        and lower(trim(player.player_name)) = lower(normalized_player_on_name)
          and (normalized_player_on_shirt = '' or trim(coalesce(player.shirt_number, '')) = normalized_player_on_shirt);

        if participant_on_match_count <> 1 or participant_player_on_id is null then
          raise exception 'Choose one eligible Match Player On from this fixture Team.' using errcode = '22023';
        end if;

      end if;

      if participant_player_id = participant_player_on_id or (named_off and named_on and lower(normalized_player_name) = lower(normalized_player_on_name)) then
        raise exception 'Choose a different Player On for this substitution.' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.match_day_events (
    match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by, created_by_name, created_by_parent_link_id,
    match_phase, phase_order, request_id, stoppage_minute, scorer_player_id, assist_player_id
  ) values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    normalized_event_type,
    normalized_team_side,
    minute_value,
    normalized_player_name,
    public.get_initials_from_full_name(normalized_player_name),
    normalized_player_shirt,
    case when normalized_event_type = 'substitution' then normalized_player_on_name else '' end,
    case when normalized_event_type = 'substitution' then public.get_initials_from_full_name(normalized_player_on_name) else '' end,
    case when normalized_event_type = 'substitution' then normalized_player_on_shirt else '' end,
    greatest(coalesce(match_row.home_score, 0), 0),
    greatest(coalesce(match_row.away_score, 0), 0),
    trim(coalesce(notes_value, '')),
    actor_record.actor_user_id,
    actor_record.actor_name,
    actor_record.actor_parent_link_id,
    match_row.current_match_phase,
    public.match_day_phase_order(match_row.current_match_phase),
    request_id_value, nullif(stoppage_minute_value,0), participant_player_id, participant_player_on_id
  )
  returning * into event_row;

  insert into public.match_day_event_log (
    club_id, team_id, match_day_id, actor_user_id, actor_display_name,
    actor_role, event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id,
    match_row.team_id,
    match_row.id,
    actor_record.actor_user_id,
    actor_record.actor_name,
    actor_record.actor_role,
    normalized_event_type,
    initcap(replace(normalized_event_type, '_', ' ')),
    null,
    jsonb_build_object(
      'eventType', normalized_event_type,
      'teamSide', normalized_team_side,
      'minute', minute_value,
      'stoppageMinute', stoppage_minute_value,
      'playerId', participant_player_id,
      'playerName', normalized_player_name,
      'playerOnId', participant_player_on_id,
      'playerOnName', normalized_player_on_name
    ),
    jsonb_build_object(
      'matchEventId', event_row.id,
      'requestId', request_id_value,
      'source', 'match_day_scorer_event_v1',
      'parentLinkId', actor_record.actor_parent_link_id
    )
  );

  return to_jsonb(event_row);
end;
$function$;
create or replace function public.claim_parent_scorer_command_notifications(command_id_value uuid default null, actor_user_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_payload jsonb;
begin
  with selected as (
    select id from private.parent_scorer_match_day_commands
    where notification_type <> '' and notification_completed_at is null and notification_attempts < 5
      and created_at > now() - interval '4 hours'
      and (command_id_value is null or id = command_id_value)
      and (actor_user_id_value is null or actor_user_id = actor_user_id_value)
      and (notification_claimed_at is null or notification_claimed_at < now() - interval '2 minutes')
    order by created_at limit 5 for update skip locked
  ), claimed as (
    update private.parent_scorer_match_day_commands c set notification_claimed_at=now(),notification_attempts=notification_attempts+1
    from selected s where c.id=s.id returning c.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'match',result->'match','actorUserId',actor_user_id,'kind',kind,'type',case when kind='request-review' then 'coach_review' else notification_type end,'eventId',event_id)
      order by created_at),'[]'::jsonb) into result_payload from claimed;
  return result_payload;
end;
$$;

revoke all on function public.claim_parent_scorer_command_notifications(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_parent_scorer_command_notifications(uuid,uuid) to service_role;

create or replace function public.authorize_match_day_push(
  actor_user_id_value uuid,
  match_day_id_value uuid,
  parent_link_id_value uuid,
  notification_type_value text,
  event_id_value uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  authorization_result jsonb;
  handover private.match_day_scorer_handovers%rowtype;
  normalized_type text := lower(trim(coalesce(notification_type_value, '')));
begin
  authorization_result := public.authorize_match_day_push_before_recipient_fanout_94(
    actor_user_id_value,
    match_day_id_value,
    parent_link_id_value,
    normalized_type,
    event_id_value
  );

  if coalesce((authorization_result ->> 'allowed')::boolean, false)
    and normalized_type <> 'scorer_selected' then
    authorization_result := jsonb_set(
      authorization_result,
      '{targetParentLinkIds}',
      to_jsonb(public.get_match_day_parent_notification_link_ids(match_day_id_value)),
      true
    );
  end if;

  select * into handover from private.match_day_scorer_handovers where match_day_id = match_day_id_value;
  if handover.match_day_id is not null
    and parent_link_id_value is not null then
    if normalized_type <> 'full_time' or handover.auth_user_id <> actor_user_id_value
      or handover.parent_link_id is distinct from parent_link_id_value then
      return jsonb_build_object('allowed', false, 'reason', 'scorer_handed_over');
    end if;
    if coalesce((authorization_result ->> 'allowed')::boolean, false) then
      authorization_result := jsonb_set(authorization_result, '{operationKey}',
        to_jsonb(concat('match-day:', match_day_id_value, ':parent-review:', handover.requested_at::text)), true);
      authorization_result := jsonb_set(authorization_result, '{notificationType}', '"coach_review"'::jsonb, true);
    end if;
  end if;
  return authorization_result;
end;
$$;
revoke all on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) to service_role;

-- Both durable handover delivery and older clients share this review operation.
create or replace function public.claim_match_day_review_push_operation(match_day_id_value uuid, actor_user_id_value uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.match_days%rowtype; h private.match_day_scorer_handovers%rowtype;
  operation_key_value text; inserted_id uuid; operation public.match_day_push_operations%rowtype;
begin
  select * into m from public.match_days where id=match_day_id_value for update;
  select * into h from private.match_day_scorer_handovers where match_day_id=m.id;
  if m.id is null or h.match_day_id is null or h.auth_user_id is distinct from actor_user_id_value then
    raise exception 'A saved scorer handover is required for this review alert.';
  end if;
  operation_key_value:=concat('match-day:',m.id,':parent-review:',h.requested_at::text);
  if m.deleted_at is not null or m.concluded_at is not null or m.status is distinct from 'full_time' then
    return jsonb_build_object('status','obsolete','operationKey',operation_key_value);
  end if;
  insert into public.match_day_push_operations(match_day_id,operation_key,notification_type,actor_user_id)
    values(m.id,operation_key_value,'full_time',actor_user_id_value)
    on conflict(operation_key) do nothing returning id into inserted_id;
  if inserted_id is not null then return jsonb_build_object('status','claimed','operationKey',operation_key_value); end if;
  select * into operation from public.match_day_push_operations where operation_key=operation_key_value for update;
  if operation.status='completed' then return jsonb_build_object('status','completed','operationKey',operation_key_value); end if;
  if operation.status='failed' or operation.updated_at < now()-interval '2 minutes' then
    update public.match_day_push_operations set status='processing',last_error='',completed_at=null,updated_at=now()
      where id=operation.id;
    return jsonb_build_object('status','claimed','operationKey',operation_key_value);
  end if;
  return jsonb_build_object('status','processing','operationKey',operation_key_value);
end;
$$;
revoke all on function public.claim_match_day_review_push_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_match_day_review_push_operation(uuid,uuid) to service_role;
