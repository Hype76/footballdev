revoke all on function public.get_parent_portal_match_days(uuid) from public;
revoke execute on function public.get_parent_portal_match_days(uuid) from anon;
grant execute on function public.get_parent_portal_match_days(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_days(uuid) to service_role;

revoke all on function public.get_parent_portal_shared_calendar_events(uuid) from public;
revoke execute on function public.get_parent_portal_shared_calendar_events(uuid) from anon;
grant execute on function public.get_parent_portal_shared_calendar_events(uuid) to authenticated;
grant execute on function public.get_parent_portal_shared_calendar_events(uuid) to service_role;

comment on function public.get_parent_portal_match_days(uuid) is
  'Parent portal matchday RPC. Execute is limited to authenticated users and service role.';

comment on function public.get_parent_portal_shared_calendar_events(uuid) is
  'Parent portal calendar RPC. Execute is limited to authenticated users and service role.';
