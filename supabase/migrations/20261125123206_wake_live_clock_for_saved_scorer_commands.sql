-- Installed scorers already wake these endpoints after committing a timer command.
-- Claim silent clock refreshes only for the authenticated command owner and exact command.
-- The live-match change queue independently retries the confirmed match state.
create or replace function public.claim_coach_match_day_command_notifications(command_id_value uuid default null, actor_user_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_payload jsonb;
begin
  with selected as (
    select id from private.coach_match_day_commands
    where (
      notification_type <> ''
      or (command_id_value is not null and actor_user_id_value is not null
        and kind = 'timer' and payload->>'action' in ('pause', 'hydration', 'resume'))
    ) and notification_completed_at is null and notification_attempts < 5
      and created_at > now() - interval '4 hours'
      and (command_id_value is null or id = command_id_value)
      and (actor_user_id_value is null or actor_user_id = actor_user_id_value)
      and (notification_claimed_at is null or notification_claimed_at < now() - interval '2 minutes')
    order by created_at limit 5 for update skip locked
  ), claimed as (
    update private.coach_match_day_commands c set notification_claimed_at=now(),notification_attempts=notification_attempts+1
    from selected s where c.id=s.id returning c.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'match',result,'type',case when notification_type = '' then 'live_clock_refresh' else notification_type end,'eventId',event_id) order by created_at),'[]'::jsonb) into result_payload from claimed;
  return result_payload;
end;
$$;

revoke all on function public.claim_coach_match_day_command_notifications(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_coach_match_day_command_notifications(uuid,uuid) to service_role;

create or replace function public.claim_parent_scorer_command_notifications(command_id_value uuid default null, actor_user_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result_payload jsonb;
begin
  with selected as (
    select id from private.parent_scorer_match_day_commands
    where (
      notification_type <> ''
      or (command_id_value is not null and actor_user_id_value is not null
        and kind = 'timer' and payload->>'action' in ('pause', 'hydration', 'resume'))
    ) and notification_completed_at is null and notification_attempts < 5
      and created_at > now() - interval '4 hours'
      and (command_id_value is null or id = command_id_value)
      and (actor_user_id_value is null or actor_user_id = actor_user_id_value)
      and (notification_claimed_at is null or notification_claimed_at < now() - interval '2 minutes')
    order by created_at limit 5 for update skip locked
  ), claimed as (
    update private.parent_scorer_match_day_commands c set notification_claimed_at=now(),notification_attempts=notification_attempts+1
    from selected s where c.id=s.id returning c.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'match',result->'match','actorUserId',actor_user_id,'kind',kind,'type',case when kind='request-review' then 'coach_review' when notification_type = '' then 'live_clock_refresh' else notification_type end,'eventId',event_id)
      order by created_at),'[]'::jsonb) into result_payload from claimed;
  return result_payload;
end;
$$;

revoke all on function public.claim_parent_scorer_command_notifications(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_parent_scorer_command_notifications(uuid,uuid) to service_role;
