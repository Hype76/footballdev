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
    legacy.parent_link_id,
    legacy.role_type,
    case
      when legacy.source_event_type = 'assessment_session'
        and assessment_session.status = 'cancelled' then 'cancelled'
      when legacy.source_event_type = 'assessment_session'
        and assessment_session.status = 'completed' then 'closed'
      else legacy.invitation_state
    end,
    legacy.response_state,
    case
      when legacy.source_event_type = 'match_day'
        and legacy.invitation_type = 'match_attendance'
        then coalesce(decision.status, 'undecided')
      else legacy.selection_state
    end,
    case
      when legacy.source_event_type = 'assessment_session'
        and assessment_session.status in ('cancelled', 'completed') then false
      else legacy.can_respond
    end,
    case
      when legacy.source_event_type = 'assessment_session'
        and assessment_session.status in ('cancelled', 'completed') then false
      else legacy.can_change_response
    end,
    case
      when legacy.source_event_type = 'assessment_session'
        and assessment_session.status = 'cancelled'
        then 'This Assessment session has been cancelled.'
      when legacy.source_event_type = 'assessment_session'
        and assessment_session.status = 'completed'
        then 'This Assessment session is complete.'
      else legacy.lock_reason
    end,
    legacy.response_deadline,
    legacy.last_responded_at
  from public.get_parent_portal_invitation_state_match_selection86_legacy(parent_link_id_value) legacy
  left join public.match_day_player_squad_decisions decision
    on legacy.source_event_type = 'match_day'
    and legacy.invitation_type = 'match_attendance'
    and decision.match_day_id = legacy.event_id
    and decision.player_id = legacy.child_id
    and decision.club_id = (
      select parent_link.club_id
      from public.parent_player_links parent_link
      where parent_link.id = parent_link_id_value
        and parent_link.auth_user_id = (select auth.uid())
        and parent_link.status = 'active'
      limit 1
    )
  left join public.assessment_sessions assessment_session
    on legacy.source_event_type = 'assessment_session'
    and assessment_session.id = legacy.event_id
  where legacy.source_event_type <> 'assessment_session'
    or assessment_session.id is not null;
$$;

revoke all on function public.get_parent_portal_invitation_state(uuid) from public;
revoke execute on function public.get_parent_portal_invitation_state(uuid) from anon;
grant execute on function public.get_parent_portal_invitation_state(uuid) to authenticated, service_role;

comment on function public.get_parent_portal_invitation_state(uuid) is
  'Authenticated Parent invitation read model with Assessment session state derived from the authoritative session lifecycle.';
