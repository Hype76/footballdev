create or replace function public.delete_previous_match_day_v2(match_day_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_role text := coalesce(public.current_user_role(), '');
  actor_role_rank integer := coalesce(public.current_user_role_rank(), 0);
  actor_club_id uuid := public.current_user_club_id();
  match_row public.match_days%rowtype;
  london_today date := timezone('Europe/London', now())::date;
begin
  if actor_user_id is null then
    raise exception 'Login is required before deleting a previous game.';
  end if;

  if match_day_id_value is null then
    raise exception 'Choose a previous game to delete.';
  end if;

  select *
  into match_row
  from public.match_days
  where id = match_day_id_value
  for update;

  if match_row.id is null then
    raise exception 'This previous game could not be found.';
  end if;

  if not exists (
    select 1
    from public.users actor_profile
    where actor_profile.id = actor_user_id
      and actor_profile.status = 'active'
  )
    or actor_role in ('admin', 'parent_portal', 'super_admin')
    or actor_role_rank < 50
    or actor_club_id is null
    or match_row.club_id <> actor_club_id
    or match_row.team_id is null
    or not exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = match_row.team_id
        and assignment.user_id = actor_user_id
    ) then
    raise exception 'Manager or Team Admin access for this assigned team is required to delete a previous game.';
  end if;

  if match_row.match_date is not null
    and match_row.match_date < london_today
    and (
      coalesce(match_row.timer_status, 'not_started') in ('running', 'paused', 'half_time', 'hydration')
      or match_row.status in ('live', 'half_time', 'second_half', 'extra_time', 'penalties')
    ) then
    update public.match_days
    set
      concluded_at = coalesce(
        concluded_at,
        (match_row.match_date + coalesce(match_row.kickoff_time, time '12:00')) at time zone 'Europe/London'
      ),
      status = 'full_time',
      timer_status = 'full_time',
      updated_at = timezone('utc', now())
    where id = match_row.id;
  end if;

  return public.delete_previous_match_day(match_day_id_value);
end;
$$;

revoke all on function public.delete_previous_match_day_v2(uuid) from public;
revoke execute on function public.delete_previous_match_day_v2(uuid) from anon;
grant execute on function public.delete_previous_match_day_v2(uuid) to authenticated;
grant execute on function public.delete_previous_match_day_v2(uuid) to service_role;

comment on function public.delete_previous_match_day_v2(uuid) is
  'Deletes an authorised previous fixture while safely closing a stale live timer on a date that has already passed. The existing audited soft-delete function remains the final authority check.';
