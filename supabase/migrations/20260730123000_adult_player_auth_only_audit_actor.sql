create or replace function public.record_adult_player_response_audit_internal(
  club_id_value uuid,
  actor_id_value uuid,
  link_id_value uuid,
  player_id_value uuid,
  team_id_value uuid,
  event_id_value uuid,
  invitation_id_value uuid,
  action_value text,
  outcome_value text,
  previous_response_value text,
  new_response_value text,
  denial_category_value text default ''
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  values (
    club_id_value,
    case
      when exists (
        select 1
        from public.users profile
        where profile.id = actor_id_value
      )
      then actor_id_value
      else null
    end,
    action_value,
    'adult_player_invitation',
    invitation_id_value,
    jsonb_build_object(
      'actorAuthUserId', actor_id_value,
      'adultPlayerLinkId', link_id_value,
      'playerId', player_id_value,
      'teamId', team_id_value,
      'eventId', event_id_value,
      'invitationId', invitation_id_value,
      'previousResponse', nullif(previous_response_value, ''),
      'newResponse', nullif(new_response_value, ''),
      'responseSource', 'adult_player',
      'outcome', outcome_value,
      'denialCategory', nullif(denial_category_value, ''),
      'recordedAt', timezone('utc', now())
    ),
    timezone('utc', now())
  );
$$;

revoke all on function public.record_adult_player_response_audit_internal(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) from public;
