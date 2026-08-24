create or replace function public.get_parent_portal_invitation_state(parent_link_id_value uuid)
returns table (
  invitation_id text,
  invitation_type text,
  source_record_id uuid,
  source_type text,
  source_event_type text,
  event_id uuid,
  event_type text,
  event_title text,
  event_date date,
  kickoff_time_tbc boolean,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  team_name text,
  child_id uuid,
  child_name text,
  parent_link_id uuid,
  role_type text,
  invitation_state text,
  response_state text,
  selection_state text,
  can_respond boolean,
  can_change_response boolean,
  lock_reason text,
  response_deadline timestamptz,
  last_responded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ),
  legacy as (
    select item.*
    from public.get_parent_portal_invitation_state_match_selection86_legacy(parent_link_id_value) item
  ),
  normalized as (
    select
      legacy.invitation_id,
      legacy.invitation_type,
      legacy.source_record_id,
      legacy.source_type,
      legacy.source_event_type,
      legacy.event_id,
      legacy.event_type,
      legacy.event_title,
      legacy.event_date,
      legacy.kickoff_time_tbc,
      legacy.event_start,
      legacy.event_end,
      legacy.event_location,
      legacy.team_name,
      legacy.child_id,
      legacy.child_name,
      target_link.id as parent_link_id,
      legacy.role_type,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'cancelled' then 'cancelled'
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'completed' then 'closed'
        else legacy.invitation_state
      end as invitation_state,
      case
        when legacy.invitation_type = 'training_attendance'
          then coalesce(training_response.status, 'awaiting_response')
        when legacy.invitation_type = 'match_attendance'
          then coalesce(match_availability.status, 'awaiting_response')
        else legacy.response_state
      end as response_state,
      case
        when legacy.source_event_type = 'match_day' and legacy.invitation_type = 'match_attendance'
          then coalesce(squad_decision.status, 'undecided')
        else legacy.selection_state
      end as selection_state,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status in ('cancelled', 'completed') then false
        when legacy.invitation_type = 'training_attendance' then
          training_request.status <> 'cancelled'
          and training_player.status not in ('cancelled', 'expired')
          and training_event.cancelled_at is null
          and training_request.occurrence_starts_at > now()
        when legacy.invitation_type = 'match_attendance' then
          match_request.id is not null
          and match_request.status <> 'expired'
          and match_request.expires_at > now()
          and match_day.status not in ('cancelled', 'postponed', 'full_time')
          and match_day.concluded_at is null
        else legacy.can_respond
      end as can_respond,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status in ('cancelled', 'completed') then false
        when legacy.invitation_type = 'training_attendance' then
          training_request.status <> 'cancelled'
          and training_player.status not in ('cancelled', 'expired')
          and training_event.cancelled_at is null
          and training_request.occurrence_starts_at > now()
        when legacy.invitation_type = 'match_attendance' then
          match_request.id is not null
          and match_request.status <> 'expired'
          and match_request.expires_at > now()
          and match_day.status not in ('cancelled', 'postponed', 'full_time')
          and match_day.concluded_at is null
        else legacy.can_change_response
      end as can_change_response,
      case
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'cancelled'
          then 'This Assessment session has been cancelled.'
        when legacy.source_event_type = 'assessment_session' and assessment.status = 'completed'
          then 'This Assessment session is complete.'
        when legacy.invitation_type = 'training_attendance'
          and training_request.status <> 'cancelled'
          and training_player.status not in ('cancelled', 'expired')
          and training_event.cancelled_at is null
          and training_request.occurrence_starts_at > now() then ''
        when legacy.invitation_type = 'match_attendance'
          and match_request.id is not null
          and match_request.status <> 'expired'
          and match_request.expires_at > now()
          and match_day.status not in ('cancelled', 'postponed', 'full_time')
          and match_day.concluded_at is null then ''
        else legacy.lock_reason
      end as lock_reason,
      legacy.response_deadline,
      case
        when legacy.invitation_type = 'training_attendance' then training_response.responded_at
        when legacy.invitation_type = 'match_attendance' then match_availability.selected_at
        else legacy.last_responded_at
      end as last_responded_at,
      row_number() over (
        partition by
          legacy.invitation_type,
          legacy.event_id,
          legacy.child_id,
          coalesce(legacy.role_type, ''),
          case
            when legacy.invitation_type = 'training_attendance' then legacy.event_start
            else null
          end
        order by
          case
            when training_player.parent_link_id = target_link.id or match_request.parent_link_id = target_link.id then 0
            else 1
          end,
          legacy.source_record_id
      ) as duplicate_rank
    from legacy
    cross join target_link
    left join public.assessment_sessions assessment
      on legacy.source_event_type = 'assessment_session'
      and assessment.id = legacy.event_id
    left join public.training_availability_request_players training_player
      on legacy.invitation_type = 'training_attendance'
      and training_player.id = legacy.source_record_id
      and training_player.club_id = target_link.club_id
      and training_player.team_id = target_link.team_id
      and training_player.player_id = target_link.player_id
    left join public.training_availability_requests training_request
      on training_request.id = training_player.request_id
    left join public.calendar_events training_event
      on training_event.id = training_request.calendar_event_id
    left join public.training_availability_responses training_response
      on training_response.request_id = training_player.request_id
      and training_response.player_id = target_link.player_id
    left join public.match_days match_day
      on legacy.invitation_type = 'match_attendance'
      and match_day.id = legacy.event_id
    left join lateral (
      select request.*
      from public.match_day_availability_requests request
      where legacy.invitation_type = 'match_attendance'
        and request.match_day_id = legacy.event_id
        and request.club_id = target_link.club_id
        and request.team_id = target_link.team_id
        and request.player_id = target_link.player_id
      order by
        case when request.parent_link_id = target_link.id then 0 else 1 end,
        request.updated_at desc,
        request.created_at desc
      limit 1
    ) match_request on true
    left join public.match_day_player_availability match_availability
      on match_availability.match_day_id = legacy.event_id
      and match_availability.player_id = target_link.player_id
    left join public.match_day_player_squad_decisions squad_decision
      on squad_decision.match_day_id = legacy.event_id
      and squad_decision.player_id = target_link.player_id
      and squad_decision.club_id = target_link.club_id
  )
  select
    item.invitation_id,
    item.invitation_type,
    item.source_record_id,
    item.source_type,
    item.source_event_type,
    item.event_id,
    item.event_type,
    item.event_title,
    item.event_date,
    item.kickoff_time_tbc,
    item.event_start,
    item.event_end,
    item.event_location,
    item.team_name,
    item.child_id,
    item.child_name,
    item.parent_link_id,
    item.role_type,
    item.invitation_state,
    item.response_state,
    item.selection_state,
    item.can_respond,
    item.can_change_response,
    item.lock_reason,
    item.response_deadline,
    item.last_responded_at
  from normalized item
  where item.duplicate_rank = 1
    and (
      item.invitation_type <> 'calendar_attendance'
      or not exists (
        select 1
        from public.training_availability_requests request
        join public.training_availability_request_players request_player
          on request_player.request_id = request.id
          and request_player.player_id = item.child_id
        where request.calendar_event_id = item.event_id
          and request.club_id = (select link.club_id from target_link link)
          and request.team_id = (select link.team_id from target_link link)
          and request.status <> 'cancelled'
      )
    )
  order by item.event_start asc nulls last, item.event_title, item.invitation_type, item.role_type nulls first;
$$;

revoke all on function public.get_parent_portal_invitation_state(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_state(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_invitation_state(uuid) is
  'Returns one child-scoped attendance request per recurring occurrence. Attendance is shared by active contacts for the child while volunteer offers remain contact-specific.';
