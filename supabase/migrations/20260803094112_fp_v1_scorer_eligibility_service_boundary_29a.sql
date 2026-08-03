begin;

create or replace function public.get_match_day_scorer_eligibility(match_day_id_value uuid)
returns table (
  request_id uuid,
  eligible boolean,
  reason text,
  parent_link_id uuid,
  auth_user_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select eligibility.request_id,
         eligibility.eligible,
         eligibility.reason,
         eligibility.parent_link_id,
         eligibility.auth_user_id
  from public.match_day_availability_requests request
  cross join lateral app_private.resolve_match_day_scorer_request_eligibility(match_day_id_value, request.id) eligibility
  where request.match_day_id = match_day_id_value;
$$;

revoke all on function public.get_match_day_scorer_eligibility(uuid) from public, anon, authenticated;
grant execute on function public.get_match_day_scorer_eligibility(uuid) to service_role;

commit;
