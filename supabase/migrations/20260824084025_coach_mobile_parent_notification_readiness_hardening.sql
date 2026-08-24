begin;

alter function public.get_team_parent_notification_readiness(uuid)
set schema app_private;

alter function app_private.get_team_parent_notification_readiness(uuid)
rename to get_team_parent_notification_readiness_internal;

revoke all on function app_private.get_team_parent_notification_readiness_internal(uuid)
from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;
grant execute on function app_private.get_team_parent_notification_readiness_internal(uuid)
to authenticated, service_role;

create or replace function public.get_team_parent_notification_readiness(team_id_value uuid)
returns table (
  player_id uuid,
  parent_contact_count integer,
  notification_ready_contact_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select readiness.player_id,
    readiness.parent_contact_count,
    readiness.notification_ready_contact_count
  from app_private.get_team_parent_notification_readiness_internal(team_id_value) readiness;
$$;

revoke all on function public.get_team_parent_notification_readiness(uuid)
from public, anon, authenticated;
grant execute on function public.get_team_parent_notification_readiness(uuid)
to authenticated, service_role;

comment on function app_private.get_team_parent_notification_readiness_internal(uuid) is
  'Privately reads notification installation authority after validating the current staff and Team scope.';
comment on function public.get_team_parent_notification_readiness(uuid) is
  'Security-invoker API wrapper for privacy-safe team Parent notification-readiness counts.';

commit;
