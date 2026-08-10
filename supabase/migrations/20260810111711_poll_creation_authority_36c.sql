-- FP-MOBILE-COMMS-POLLS-PRIVACY-CORRECTIVE-36 Poll creation authority.
-- Only canonical Club Admin may create a Club-wide Poll. Other established
-- Poll creators are constrained to their current, explicitly assigned Team.

create or replace function app_private.poll_actor_can_create_in_scope(
  target_user_id uuid,
  target_team_id uuid,
  active_team_id_value uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.users actor
      join public.user_club_memberships membership
        on membership.auth_user_id = actor.id
       and membership.club_id = actor.club_id
       and membership.role = actor.role
       and membership.role_rank = actor.role_rank
      join public.clubs club
        on club.id = actor.club_id
       and club.archived_at is null
       and coalesce(club.status, 'active') = 'active'
      where actor.id = target_user_id
        and coalesce(actor.status, 'active') = 'active'
        and actor.role in ('admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
        and (
          (
            actor.role = 'admin'
            and (
              target_team_id is null
              or exists (
                select 1
                from public.teams team
                where team.id = target_team_id
                  and team.club_id = actor.club_id
                  and team.archived_at is null
                  and coalesce(team.status, 'active') = 'active'
              )
            )
          )
          or (
            actor.role in ('head_manager', 'manager', 'coach', 'assistant_coach')
            and target_team_id is not null
            and active_team_id_value = target_team_id
            and exists (
              select 1
              from public.team_staff assignment
              join public.teams team
                on team.id = assignment.team_id
               and team.club_id = actor.club_id
               and team.archived_at is null
               and coalesce(team.status, 'active') = 'active'
              where assignment.user_id = actor.id
                and assignment.team_id = target_team_id
            )
          )
        )
    );
$$;

alter function app_private.poll_actor_can_create_in_scope(uuid, uuid, uuid) owner to postgres;
revoke all on function app_private.poll_actor_can_create_in_scope(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke execute on function public.create_team_poll(
  uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) from authenticated;

create or replace function public.create_team_poll(
  p_active_team_id uuid,
  p_team_id uuid,
  p_title text,
  p_description text,
  p_audience text,
  p_poll_type text,
  p_options jsonb,
  p_closes_at timestamptz,
  p_allow_multiple boolean,
  p_max_choices integer,
  p_allow_own_child_votes boolean,
  p_allow_vote_changes boolean,
  p_hide_votes boolean,
  p_allow_comments boolean,
  p_request_id uuid
)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  target_club_id uuid;
  result_poll public.polls%rowtype;
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_description text := btrim(coalesce(p_description, ''));
  normalized_audience text := lower(btrim(coalesce(p_audience, '')));
  normalized_poll_type text := lower(btrim(coalesce(p_poll_type, '')));
  option_count integer;
begin
  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = (select auth.uid())
  for key share;

  if actor.id is null
    or not app_private.poll_actor_can_create_in_scope(actor.id, p_team_id, p_active_team_id) then
    raise exception using errcode = '42501', message = 'poll_change_not_permitted';
  end if;

  target_club_id := actor.club_id;

  if normalized_title = ''
    or length(normalized_title) > 160
    or length(normalized_description) > 2000
    or normalized_audience not in ('parents', 'staff')
    or normalized_poll_type not in ('text', 'time', 'awards')
    or p_request_id is null
    or jsonb_typeof(p_options) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'poll_definition_invalid';
  end if;

  option_count := jsonb_array_length(p_options);

  if option_count < 2
    or option_count > 50
    or exists (
      select 1
      from jsonb_array_elements(p_options) option_row
      where jsonb_typeof(option_row) is distinct from 'object'
        or btrim(coalesce(option_row ->> 'id', '')) = ''
        or length(btrim(coalesce(option_row ->> 'id', ''))) > 80
        or btrim(coalesce(option_row ->> 'label', '')) = ''
        or length(btrim(coalesce(option_row ->> 'label', ''))) > 160
    )
    or (
      select count(distinct btrim(option_row ->> 'id'))
      from jsonb_array_elements(p_options) option_row
    ) <> option_count
    or (p_closes_at is not null and p_closes_at <= timezone('utc', now()))
    or (
      coalesce(p_allow_multiple, false)
      and (p_max_choices is null or p_max_choices < 1 or p_max_choices > option_count)
    ) then
    raise exception using errcode = '22023', message = 'poll_definition_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor.id::text || ':' || p_request_id::text, 0));

  insert into public.polls (
    club_id,
    team_id,
    title,
    description,
    audience,
    poll_type,
    options,
    status,
    closes_at,
    allow_multiple,
    max_choices,
    allow_own_child_votes,
    allow_vote_changes,
    hide_votes,
    allow_comments,
    created_by,
    created_by_name,
    privileged_request_id
  )
  values (
    target_club_id,
    p_team_id,
    normalized_title,
    normalized_description,
    normalized_audience,
    normalized_poll_type,
    p_options,
    'open',
    p_closes_at,
    coalesce(p_allow_multiple, false),
    case when coalesce(p_allow_multiple, false) then p_max_choices else null end,
    case when normalized_audience = 'parents' then coalesce(p_allow_own_child_votes, true) else true end,
    coalesce(p_allow_vote_changes, true),
    coalesce(p_hide_votes, false),
    coalesce(p_allow_comments, false),
    actor.id,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    p_request_id
  )
  on conflict (created_by, privileged_request_id)
    where privileged_request_id is not null
    do nothing
  returning * into result_poll;

  if result_poll.id is null then
    select poll.*
    into result_poll
    from public.polls poll
    where poll.created_by = actor.id
      and poll.privileged_request_id = p_request_id
      and poll.club_id = target_club_id
      and poll.team_id is not distinct from p_team_id
      and poll.title = normalized_title
      and poll.audience = normalized_audience
      and poll.poll_type = normalized_poll_type
      and poll.options = p_options
    for update;

    if result_poll.id is null then
      raise exception using errcode = '55000', message = 'poll_request_conflict';
    end if;

    return result_poll;
  end if;

  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_club_id,
    actor.id,
    'poll_created',
    'poll',
    result_poll.id,
    jsonb_build_object(
      'teamId', p_team_id,
      'activeTeamId', p_active_team_id,
      'requestId', p_request_id,
      'audience', normalized_audience,
      'pollType', normalized_poll_type,
      'optionCount', option_count
    )
  );

  return result_poll;
end;
$$;

alter function public.create_team_poll(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) owner to postgres;
revoke all on function public.create_team_poll(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) from public, anon, service_role;
grant execute on function public.create_team_poll(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) to authenticated;

comment on function public.create_team_poll(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) is
  'Creates a Poll using canonical Club Admin authority or exact active assigned-Team authority. Parent, Player, Platform Admin, wrong-Team, archived-Team, and Club-wide non-Club-Admin requests fail closed.';
