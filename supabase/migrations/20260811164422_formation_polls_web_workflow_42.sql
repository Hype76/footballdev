-- FP-V1-FORMATION-POLLS-WEB-WORKFLOW-42
-- Correct unlimited multiple-choice Polls and add immutable parent Match Plan publishing.

alter function public.create_team_poll(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) rename to create_team_poll_workflow42_legacy;

revoke all on function public.create_team_poll_workflow42_legacy(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
  boolean, boolean, boolean, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.create_team_poll(
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
  result_poll public.polls%rowtype;
  effective_max_choices integer;
begin
  effective_max_choices := case
    when coalesce(p_allow_multiple, false)
      and p_max_choices is null
      and jsonb_typeof(p_options) = 'array'
      then jsonb_array_length(coalesce(p_options, '[]'::jsonb))
    else p_max_choices
  end;

  result_poll := public.create_team_poll_workflow42_legacy(
    p_active_team_id,
    p_team_id,
    p_title,
    p_description,
    p_audience,
    p_poll_type,
    p_options,
    p_closes_at,
    p_allow_multiple,
    effective_max_choices,
    p_allow_own_child_votes,
    p_allow_vote_changes,
    p_hide_votes,
    p_allow_comments,
    p_request_id
  );

  if coalesce(p_allow_multiple, false) and p_max_choices is null then
    update public.polls poll
    set max_choices = null
    where poll.id = result_poll.id
    returning poll.* into result_poll;
  end if;

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

alter function public.submit_staff_poll_vote(uuid, text)
rename to submit_staff_poll_vote_workflow42_legacy;

revoke all on function public.submit_staff_poll_vote_workflow42_legacy(uuid, text)
from public, anon, authenticated, service_role;

create function public.submit_staff_poll_vote(p_poll_id uuid, p_option_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  poll_row public.polls%rowtype;
  normalized_option_id text := btrim(coalesce(p_option_id, ''));
  existing_vote_id uuid;
begin
  select poll.* into poll_row
  from public.polls poll
  where poll.id = p_poll_id
  for update;

  if actor_id is null
    or poll_row.id is null
    or poll_row.status <> 'open'
    or (poll_row.closes_at is not null and poll_row.closes_at <= timezone('utc', now()))
    or normalized_option_id = ''
    or not app_private.actor_can_manage_team_resource(actor_id, poll_row.club_id, poll_row.team_id, 20)
    or not exists (
      select 1 from jsonb_array_elements(poll_row.options) option_row
      where option_row ->> 'id' = normalized_option_id
    ) then
    raise exception using errcode = '42501', message = 'poll_vote_not_permitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor_id::text, 0));

  select vote.id into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor_id
    and vote.option_id = normalized_option_id
  for update;

  if existing_vote_id is not null
    and poll_row.allow_multiple is true
    and poll_row.allow_vote_changes is true then
    delete from public.poll_votes vote where vote.id = existing_vote_id;
    insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      poll_row.club_id,
      actor_id,
      'poll_vote_removed',
      'poll',
      poll_row.id,
      jsonb_build_object('teamId', poll_row.team_id, 'optionId', normalized_option_id)
    );
    return existing_vote_id;
  end if;

  return public.submit_staff_poll_vote_workflow42_legacy(p_poll_id, normalized_option_id);
end;
$$;

alter function public.submit_staff_poll_vote(uuid, text) owner to postgres;
revoke all on function public.submit_staff_poll_vote(uuid, text) from public, anon, service_role;
grant execute on function public.submit_staff_poll_vote(uuid, text) to authenticated;

alter function public.submit_parent_portal_poll_vote(uuid, uuid, text)
rename to submit_parent_portal_poll_vote_workflow42_legacy;

revoke all on function public.submit_parent_portal_poll_vote_workflow42_legacy(uuid, uuid, text)
from public, anon, authenticated, service_role;

create function public.submit_parent_portal_poll_vote(
  parent_link_id_value uuid,
  poll_id_value uuid,
  option_id_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  link_row public.parent_player_links%rowtype;
  poll_row public.polls%rowtype;
  normalized_option_id text := btrim(coalesce(option_id_value, ''));
  existing_vote_id uuid;
begin
  if actor_id is null
    or not public.current_user_has_active_authority()
    or public.current_user_role() <> 'parent_portal' then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select link.* into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_id
    and link.status = 'active'
  for key share;

  select poll.* into poll_row
  from public.polls poll
  where poll.id = poll_id_value
    and poll.club_id = link_row.club_id
    and poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.team_id is null or poll.team_id = link_row.team_id)
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
    and exists (
      select 1 from jsonb_array_elements(poll.options) option_row
      where option_row ->> 'id' = normalized_option_id
    )
  for update;

  if link_row.id is null or poll_row.id is null then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor_id::text, 0));

  select vote.id into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor_id
    and vote.option_id = normalized_option_id
  for update;

  if existing_vote_id is not null
    and poll_row.allow_multiple is true
    and poll_row.allow_vote_changes is true then
    delete from public.poll_votes vote where vote.id = existing_vote_id;
    insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      poll_row.club_id,
      actor_id,
      'parent_poll_vote_removed',
      'poll',
      poll_row.id,
      jsonb_build_object('teamId', poll_row.team_id, 'parentLinkId', link_row.id, 'optionId', normalized_option_id)
    );
    return existing_vote_id;
  end if;

  return public.submit_parent_portal_poll_vote_workflow42_legacy(
    parent_link_id_value,
    poll_id_value,
    normalized_option_id
  );
end;
$$;

alter function public.submit_parent_portal_poll_vote(uuid, uuid, text) owner to postgres;
revoke all on function public.submit_parent_portal_poll_vote(uuid, uuid, text)
from public, anon, service_role;
grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to authenticated;

alter table public.formation_boards
add column linked_match_day_id uuid references public.match_days(id) on delete set null;

create index formation_boards_linked_match_idx
on public.formation_boards(linked_match_day_id)
where linked_match_day_id is not null and deleted_at is null;

create table public.formation_board_match_publications (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  board_version_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  match_day_id uuid not null references public.match_days(id) on delete cascade,
  publication_number integer not null,
  board_title_snapshot text not null,
  published_by_profile_id uuid not null references public.users(id),
  published_by_name text not null default '',
  published_at timestamptz not null default timezone('utc', now()),
  withdrawn_at timestamptz,
  withdrawn_by_profile_id uuid references public.users(id),
  constraint formation_board_match_publications_version_fkey
    foreign key (board_version_id, board_id, club_id, team_id)
    references public.formation_board_versions(id, board_id, club_id, team_id) on delete cascade,
  constraint formation_board_match_publications_number_check check (publication_number > 0),
  constraint formation_board_match_publications_title_check check (char_length(btrim(board_title_snapshot)) between 1 and 120),
  unique (match_day_id, publication_number)
);

create index formation_board_match_publications_board_idx
on public.formation_board_match_publications(board_id, publication_number desc);

create index formation_board_match_publications_match_latest_idx
on public.formation_board_match_publications(match_day_id, publication_number desc);

create index formation_board_match_publications_version_idx
on public.formation_board_match_publications(board_version_id);

alter table public.formation_board_match_publications enable row level security;
revoke all on table public.formation_board_match_publications from public, anon, authenticated;
grant all on table public.formation_board_match_publications to service_role;

create function public.link_formation_board_to_match(target_board_id uuid, target_match_day_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  board public.formation_boards%rowtype;
  fixture public.match_days%rowtype;
begin
  select item.* into board
  from public.formation_boards item
  where item.id = target_board_id
    and item.deleted_at is null
    and item.archived_at is null
  for update;

  select item.* into fixture
  from public.match_days item
  where item.id = target_match_day_id
    and item.deleted_at is null
    and item.status not in ('cancelled', 'postponed')
  for key share;

  if actor_id is null or board.id is null
    or not app_private.formation_board_can_edit(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_edit_forbidden';
  end if;

  if fixture.id is null or fixture.club_id <> board.club_id or fixture.team_id <> board.team_id then
    raise exception using errcode = '22023', message = 'formation_board_match_invalid';
  end if;

  update public.formation_boards item
  set linked_match_day_id = fixture.id
  where item.id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_match_linked',
    board.id,
    jsonb_build_object('matchDayId', fixture.id, 'parentVisible', false, 'notificationSent', false)
  );

  return public.get_formation_board(board.id);
end;
$$;

create function public.list_formation_board_match_publications(target_board_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not app_private.formation_board_can_view(actor_id, target_board_id) then
    raise exception using errcode = '42501', message = 'formation_board_forbidden';
  end if;

  return query
  select to_jsonb(publication) || jsonb_build_object(
    'game_format', version.game_format,
    'formation_preset_key', version.formation_preset_key,
    'pitch_orientation', version.pitch_orientation,
    'placements', version.placements,
    'bench', (
      select coalesce(jsonb_agg((player - 'state') || jsonb_build_object('state', 'bench') order by ordinal), '[]'::jsonb)
      from jsonb_array_elements(version.bench) with ordinality roster(player, ordinal)
    )
  )
  from public.formation_board_match_publications publication
  join public.formation_board_versions version on version.id = publication.board_version_id
  where publication.board_id = target_board_id
  order by publication.published_at desc;
end;
$$;

create function public.publish_formation_board_match_plan(
  target_board_id uuid,
  target_version_id uuid,
  target_match_day_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  fixture public.match_days%rowtype;
  publication public.formation_board_match_publications%rowtype;
  next_number integer;
begin
  select item.* into board
  from public.formation_boards item
  where item.id = target_board_id
    and item.deleted_at is null
    and item.archived_at is null
  for update;

  if actor_id is null or board.id is null
    or not app_private.formation_board_can_edit(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_publish_forbidden';
  end if;

  if board.linked_match_day_id is distinct from target_match_day_id then
    raise exception using errcode = '22023', message = 'formation_board_match_link_required';
  end if;

  select item.* into fixture
  from public.match_days item
  where item.id = target_match_day_id
    and item.club_id = board.club_id
    and item.team_id = board.team_id
    and item.deleted_at is null
    and item.status not in ('cancelled', 'postponed')
  for key share;

  select item.* into version
  from public.formation_board_versions item
  where item.id = target_version_id
    and item.board_id = board.id
    and item.id = board.current_version_id
  for key share;

  if fixture.id is null then
    raise exception using errcode = '22023', message = 'formation_board_match_invalid';
  end if;
  if version.id is null then
    raise exception using errcode = '22023', message = 'formation_board_version_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_match_day_id::text, 0));
  select coalesce(max(item.publication_number), 0) + 1 into next_number
  from public.formation_board_match_publications item
  where item.match_day_id = target_match_day_id;

  select coalesce(app_user.name, app_user.display_name, app_user.username, app_user.email, '')
  into actor_name
  from public.users app_user
  where app_user.id = actor_id;

  insert into public.formation_board_match_publications (
    board_id,
    board_version_id,
    club_id,
    team_id,
    match_day_id,
    publication_number,
    board_title_snapshot,
    published_by_profile_id,
    published_by_name
  ) values (
    board.id,
    version.id,
    board.club_id,
    board.team_id,
    fixture.id,
    next_number,
    board.title,
    actor_id,
    actor_name
  ) returning * into publication;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_match_plan_published',
    board.id,
    jsonb_build_object(
      'matchDayId', fixture.id,
      'boardVersionId', version.id,
      'publicationId', publication.id,
      'publicationNumber', publication.publication_number,
      'parentVisible', true,
      'notificationSent', false
    )
  );

  return to_jsonb(publication) || jsonb_build_object(
    'game_format', version.game_format,
    'formation_preset_key', version.formation_preset_key,
    'pitch_orientation', version.pitch_orientation,
    'placements', version.placements,
    'bench', version.bench
  );
end;
$$;

create function public.withdraw_formation_board_match_plan(target_board_id uuid, target_match_day_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  board public.formation_boards%rowtype;
  publication public.formation_board_match_publications%rowtype;
  version public.formation_board_versions%rowtype;
begin
  select item.* into board
  from public.formation_boards item
  where item.id = target_board_id
    and item.deleted_at is null
    and item.archived_at is null
  for update;

  if actor_id is null or board.id is null
    or not app_private.formation_board_can_edit(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_publish_forbidden';
  end if;

  select item.* into publication
  from public.formation_board_match_publications item
  where item.board_id = board.id
    and item.match_day_id = target_match_day_id
    and item.withdrawn_at is null
  order by item.publication_number desc
  limit 1
  for update;

  if publication.id is null then
    raise exception using errcode = '22023', message = 'formation_board_match_publication_not_found';
  end if;

  update public.formation_board_match_publications item
  set withdrawn_at = timezone('utc', now()),
      withdrawn_by_profile_id = actor_id
  where item.id = publication.id
  returning * into publication;

  select item.* into version
  from public.formation_board_versions item
  where item.id = publication.board_version_id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_match_plan_withdrawn',
    board.id,
    jsonb_build_object(
      'matchDayId', target_match_day_id,
      'publicationId', publication.id,
      'publicationNumber', publication.publication_number,
      'parentVisible', false,
      'notificationSent', false
    )
  );

  return to_jsonb(publication) || jsonb_build_object(
    'game_format', version.game_format,
    'formation_preset_key', version.formation_preset_key,
    'pitch_orientation', version.pitch_orientation,
    'placements', version.placements,
    'bench', version.bench
  );
end;
$$;

create function public.get_parent_portal_match_formation_plans(parent_link_id_value uuid)
returns table (
  match_day_id uuid,
  publication_id uuid,
  publication_number integer,
  board_title_snapshot text,
  published_at timestamptz,
  game_format text,
  formation_preset_key text,
  pitch_orientation text,
  placements jsonb,
  bench jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with parent_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
      and public.current_user_has_active_authority()
      and public.current_user_role() = 'parent_portal'
    limit 1
  ),
  ranked as (
    select
      publication.*,
      row_number() over (
        partition by publication.match_day_id
        order by publication.publication_number desc
      ) as publication_rank
    from public.formation_board_match_publications publication
    join parent_link link
      on link.club_id = publication.club_id
     and link.team_id = publication.team_id
  )
  select
    publication.match_day_id,
    publication.id,
    publication.publication_number,
    publication.board_title_snapshot,
    publication.published_at,
    version.game_format,
    version.formation_preset_key,
    version.pitch_orientation,
    version.placements,
    (
      select coalesce(jsonb_agg((player - 'state') || jsonb_build_object('state', 'bench') order by ordinal), '[]'::jsonb)
      from jsonb_array_elements(version.bench) with ordinality roster(player, ordinal)
    )
  from ranked publication
  join public.formation_board_versions version on version.id = publication.board_version_id
  where publication.publication_rank = 1
    and publication.withdrawn_at is null
    and exists (
      select 1
      from public.get_parent_portal_match_days(parent_link_id_value) visible_match
      where visible_match.id = publication.match_day_id
    )
  order by publication.published_at desc;
$$;

alter function public.link_formation_board_to_match(uuid, uuid) owner to postgres;
alter function public.list_formation_board_match_publications(uuid) owner to postgres;
alter function public.publish_formation_board_match_plan(uuid, uuid, uuid) owner to postgres;
alter function public.withdraw_formation_board_match_plan(uuid, uuid) owner to postgres;
alter function public.get_parent_portal_match_formation_plans(uuid) owner to postgres;

revoke all on function public.link_formation_board_to_match(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_formation_board_match_publications(uuid) from public, anon, service_role;
revoke all on function public.publish_formation_board_match_plan(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.withdraw_formation_board_match_plan(uuid, uuid) from public, anon, service_role;
revoke all on function public.get_parent_portal_match_formation_plans(uuid) from public, anon, service_role;

grant execute on function public.link_formation_board_to_match(uuid, uuid) to authenticated;
grant execute on function public.list_formation_board_match_publications(uuid) to authenticated;
grant execute on function public.publish_formation_board_match_plan(uuid, uuid, uuid) to authenticated;
grant execute on function public.withdraw_formation_board_match_plan(uuid, uuid) to authenticated;
grant execute on function public.get_parent_portal_match_formation_plans(uuid) to authenticated;

comment on function public.get_parent_portal_match_formation_plans(uuid) is
  'Returns only the latest active immutable pitch and Bench publication for matches visible to the current parent link. Staff notes and unselected Players are excluded.';
