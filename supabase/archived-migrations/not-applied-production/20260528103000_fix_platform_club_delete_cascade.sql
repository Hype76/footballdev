drop function if exists public.delete_platform_club_cascade(uuid);

create or replace function public.delete_platform_club_cascade(target_club_id uuid)
returns table (deleted boolean, club_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_name text;
  deleted_count integer := 0;
begin
  if target_club_id is null then
    raise exception 'Club ID is required.';
  end if;

  if auth.uid() is null then
    raise exception 'Login is required before deleting a club workspace.';
  end if;

  if not exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'super_admin'
  ) then
    raise exception 'Only platform admins can delete clubs.';
  end if;

  select name
  into target_club_name
  from public.clubs
  where id = target_club_id;

  if target_club_name is null then
    raise exception 'Club workspace was not found.';
  end if;

  delete from public.user_club_memberships membership
  where membership.club_id = target_club_id
     or not exists (
       select 1
       from public.clubs club
       where club.id = membership.club_id
     );

  delete from public.parent_portal_message_reads read_row
  where exists (
    select 1
    from public.parent_player_links link
    where link.id = read_row.parent_link_id
      and link.club_id = target_club_id
  )
  or exists (
    select 1
    from public.communication_logs log
    where log.id = read_row.communication_log_id
      and log.club_id = target_club_id
  );

  delete from public.parent_push_subscriptions
  where club_id = target_club_id;

  delete from public.match_day_scorer_assignments
  where club_id = target_club_id
     or exists (
       select 1
       from public.match_days match_day
       where match_day.id = match_day_scorer_assignments.match_day_id
         and match_day.club_id = target_club_id
     );

  delete from public.match_day_scorer_interest
  where club_id = target_club_id
     or exists (
       select 1
       from public.match_days match_day
       where match_day.id = match_day_scorer_interest.match_day_id
         and match_day.club_id = target_club_id
     );

  delete from public.match_day_availability_requests
  where club_id = target_club_id;

  delete from public.match_day_events
  where club_id = target_club_id;

  delete from public.match_days
  where club_id = target_club_id;

  delete from public.match_locations
  where club_id = target_club_id;

  delete from public.poll_votes
  where club_id = target_club_id;

  delete from public.polls
  where club_id = target_club_id;

  delete from public.scheduled_email_queue
  where club_id = target_club_id;

  delete from public.parent_player_links
  where club_id = target_club_id;

  delete from public.parent_email_templates
  where club_id = target_club_id;

  delete from public.player_staff_notes
  where club_id = target_club_id;

  if to_regclass('public.assessment_session_games') is not null then
    execute 'delete from public.assessment_session_games where club_id = $1'
    using target_club_id;
  end if;

  delete from public.assessment_sessions
  where club_id = target_club_id;

  delete from public.record_backups
  where club_id = target_club_id;

  delete from public.communication_logs
  where club_id = target_club_id;

  delete from public.evaluations
  where club_id = target_club_id;

  delete from public.form_fields
  where club_id = target_club_id;

  delete from public.club_roles
  where club_id = target_club_id;

  delete from public.club_user_invites
  where club_id = target_club_id;

  delete from public.team_staff staff
  where exists (
    select 1
    from public.teams team
    where team.id = staff.team_id
      and team.club_id = target_club_id
  );

  delete from public.teams
  where club_id = target_club_id;

  delete from public.players
  where club_id = target_club_id;

  delete from public.platform_feedback
  where club_id = target_club_id;

  update public.stripe_checkout_records
  set club_id = null,
      updated_at = now()
  where club_id = target_club_id;

  update public.users
  set club_id = null
  where club_id = target_club_id
    and role = 'super_admin';

  delete from public.users
  where club_id = target_club_id
    and role <> 'super_admin';

  delete from public.clubs
  where id = target_club_id;

  get diagnostics deleted_count = row_count;

  if deleted_count <> 1 then
    raise exception 'Club workspace could not be deleted.';
  end if;

  return query select true, target_club_name;
end;
$$;

grant execute on function public.delete_platform_club_cascade(uuid) to authenticated;
