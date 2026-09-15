-- Parent handover is persisted separately from match conclusion and cannot be reversed by a client.
create schema if not exists private;
create table if not exists private.match_day_scorer_handovers (
  match_day_id uuid primary key references public.match_days(id) on delete cascade,
  parent_link_id uuid not null,
  auth_user_id uuid not null,
  requested_at timestamptz not null default now()
);
alter table private.match_day_scorer_handovers enable row level security;
revoke all on private.match_day_scorer_handovers from public, anon, authenticated;
grant select on private.match_day_scorer_handovers to service_role;

CREATE OR REPLACE FUNCTION public.current_user_is_match_day_scorer(target_match_day_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select ((public.current_user_has_match_day_scorer_assignment(target_match_day_id)
    and not exists (select 1 from private.match_day_scorer_handovers handover where handover.match_day_id = target_match_day_id))
    or private.is_guest_match_scorer(target_match_day_id))
    and public.match_day_local_date_is_today(target_match_day_id)
    and exists (
      select 1
      from public.match_days match_day
      where match_day.id = target_match_day_id
        and match_day.deleted_at is null
        and match_day.concluded_at is null
        and match_day.status not in ('cancelled', 'postponed')
    );
$function$
;
revoke all on function public.current_user_is_match_day_scorer(uuid) from public, anon;
grant execute on function public.current_user_is_match_day_scorer(uuid) to authenticated, service_role;

create or replace function public.get_parent_scorer_game_mode_match_ids(
  parent_link_id_value uuid
)
returns table (match_day_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select match_day.id
  from public.match_days match_day
  join public.clubs club on club.id = match_day.club_id
  join public.match_day_role_assignments role_assignment
    on role_assignment.match_day_id = match_day.id
   and role_assignment.role = 'scorer'
   and role_assignment.parent_link_id = parent_link_id_value
   and role_assignment.auth_user_id = (select auth.uid())
   and role_assignment.club_id = match_day.club_id
   and role_assignment.team_id = match_day.team_id
  join public.match_day_scorer_assignments legacy_assignment
    on legacy_assignment.match_day_id = match_day.id
   and legacy_assignment.parent_link_id = role_assignment.parent_link_id
   and legacy_assignment.auth_user_id = role_assignment.auth_user_id
   and legacy_assignment.club_id = role_assignment.club_id
   and legacy_assignment.team_id = role_assignment.team_id
  join public.parent_player_links parent_link
    on parent_link.id = role_assignment.parent_link_id
   and parent_link.auth_user_id = role_assignment.auth_user_id
   and parent_link.club_id = match_day.club_id
   and parent_link.team_id = match_day.team_id
   and parent_link.status = 'active'
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = match_day.club_id
   and player.team_id = match_day.team_id
   and coalesce(player.status, 'active') <> 'archived'
  where public.current_user_is_match_day_scorer(match_day.id)
    and match_day.deleted_at is null
    and match_day.concluded_at is null
    and match_day.status not in ('cancelled', 'postponed')
    and match_day.match_date = timezone(
      coalesce(nullif(trim(club.timezone_name), ''), 'Europe/London'),
      statement_timestamp()
    )::date;
$$;
revoke all on function public.get_parent_scorer_game_mode_match_ids(uuid) from public, anon;
grant execute on function public.get_parent_scorer_game_mode_match_ids(uuid) to authenticated, service_role;

create or replace function public.request_parent_match_day_review(match_day_id_value uuid, parent_link_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.match_days%rowtype;
  handover private.match_day_scorer_handovers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Login is required before sending this match to the Coach.';
  end if;
  -- Serialize with scoring RPCs so no stale action can race a successful handover.
  select * into match_row from public.match_days where id = match_day_id_value for update;
  if match_row.id is null or match_row.deleted_at is not null then
    raise exception 'This match day could not be found.';
  end if;
  if not public.current_user_has_match_day_scorer_assignment(match_row.id)
    or not exists (
      select 1 from public.match_day_role_assignments assignment
      where assignment.match_day_id = match_row.id and assignment.role = 'scorer'
        and assignment.parent_link_id = parent_link_id_value and assignment.auth_user_id = auth.uid()
    ) then
    raise exception 'Current selected Parent scorer access is required to send this match to the Coach.';
  end if;
  select * into handover from private.match_day_scorer_handovers where match_day_id = match_row.id;
  if handover.match_day_id is not null then
    return jsonb_build_object('matchDayId', match_row.id, 'scorerReviewRequestedAt', handover.requested_at);
  end if;
  if match_row.status <> 'full_time' or match_row.concluded_at is not null then
    raise exception 'Finish the match before sending it to the Coach for review.';
  end if;
  if not public.current_user_is_match_day_scorer(match_row.id) then
    raise exception 'Current selected Parent scorer access is required to send this match to the Coach.';
  end if;
  insert into private.match_day_scorer_handovers(match_day_id, parent_link_id, auth_user_id)
    values (match_row.id, parent_link_id_value, auth.uid()) returning * into handover;
  insert into public.match_day_event_log(
    club_id, team_id, match_day_id, actor_user_id, actor_display_name, actor_role,
    event_type, event_label, previous_value, new_value, metadata
  ) values (
    match_row.club_id, match_row.team_id, match_row.id, auth.uid(),
    coalesce(auth.jwt()->>'name', auth.jwt()->>'email', ''), 'scorer_parent',
    'scorer_updated', 'Sent to Coach for conclusion', '{}'::jsonb,
    jsonb_build_object('scorerReviewRequestedAt', handover.requested_at),
    jsonb_build_object('source', 'parent_scorer_handover', 'parentLinkId', parent_link_id_value)
  );
  return jsonb_build_object('matchDayId', match_row.id, 'scorerReviewRequestedAt', handover.requested_at);
end;
$$;
revoke all on function public.request_parent_match_day_review(uuid, uuid) from public, anon;
grant execute on function public.request_parent_match_day_review(uuid, uuid) to authenticated, service_role;

create or replace function public.get_parent_match_day_review_requests(parent_link_id_value uuid)
returns table(match_day_id uuid, scorer_review_requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select handover.match_day_id, handover.requested_at
  from private.match_day_scorer_handovers handover
  join public.parent_player_links link on link.id = parent_link_id_value
  join public.match_days match_day on match_day.id = handover.match_day_id
    and match_day.club_id = link.club_id and match_day.team_id = link.team_id
  where auth.uid() is not null
    and handover.auth_user_id = auth.uid()
    and handover.parent_link_id = link.id
    and public.current_user_can_access_parent_link(link.id, link.player_id)
    and match_day.deleted_at is null;
$$;
revoke all on function public.get_parent_match_day_review_requests(uuid) from public, anon;
grant execute on function public.get_parent_match_day_review_requests(uuid) to authenticated, service_role;

-- Only the saved handover owner may retry its conclusion alert. Other scorer pushes stay closed.
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
    end if;
  end if;
  return authorization_result;
end;
$$;
revoke all on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_match_day_push(uuid, uuid, uuid, text, uuid) to service_role;
