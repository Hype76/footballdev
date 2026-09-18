-- Atomic Coach Formation Board save for one current Match.
-- The existing editor/link/publish RPCs remain available for web compatibility.

create or replace function public.save_coach_match_formation(
  title_value text,
  description_value text,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  notes_value text,
  registry_version_value integer,
  target_match_day_id uuid,
  target_board_id uuid default null,
  expected_version_number integer default null,
  shared_value boolean default false,
  version_reason_value text default 'coach_match_save'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  fixture public.match_days%rowtype;
  existing_board public.formation_boards%rowtype;
  saved_board jsonb;
  board_id_value uuid;
  current_version_id_value uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select item.* into fixture
  from public.match_days item
  where item.id = target_match_day_id
    and item.deleted_at is null
    and item.status not in ('cancelled', 'postponed')
  for key share;

  if fixture.id is null then
    raise exception using errcode = '22023', message = 'formation_board_match_invalid';
  end if;

  if target_board_id is null then
    saved_board := public.create_formation_board(
      fixture.team_id,
      title_value,
      coalesce(description_value, ''),
      game_format_value,
      preset_key_value,
      pitch_orientation_value,
      placements_value,
      bench_value,
      coalesce(notes_value, ''),
      'shared',
      registry_version_value
    );
  else
    select item.* into existing_board
    from public.formation_boards item
    where item.id = target_board_id
      and item.deleted_at is null
      and item.archived_at is null
    for update;

    if existing_board.id is null
      or existing_board.club_id <> fixture.club_id
      or existing_board.team_id <> fixture.team_id then
      raise exception using errcode = '22023', message = 'formation_board_match_invalid';
    end if;

    if exists (
      select 1
      from public.formation_boards item
      where item.id = target_board_id
        and item.linked_match_day_id is not null
        and item.linked_match_day_id <> target_match_day_id
    ) then
      raise exception using errcode = '22023', message = 'formation_board_match_already_linked';
    end if;

    saved_board := public.save_formation_board_editor(
      target_board_id,
      expected_version_number,
      title_value,
      description_value,
      game_format_value,
      preset_key_value,
      pitch_orientation_value,
      placements_value,
      bench_value,
      notes_value,
      'shared',
      coalesce(version_reason_value, 'coach_match_save'),
      registry_version_value
    );
  end if;

  board_id_value := (saved_board->'board'->>'id')::uuid;
  current_version_id_value := (saved_board->'board'->>'current_version_id')::uuid;

  if board_id_value is null or current_version_id_value is null then
    raise exception using errcode = 'P0002', message = 'formation_board_not_found';
  end if;

  perform public.link_formation_board_to_match(board_id_value, target_match_day_id);

  if coalesce(shared_value, false) then
    perform public.publish_formation_board_match_plan(
      board_id_value,
      current_version_id_value,
      target_match_day_id
    );
  else
    begin
      perform public.withdraw_formation_board_match_plan(board_id_value, target_match_day_id);
    exception
      when sqlstate '22023' then
        if sqlerrm <> 'formation_board_match_publication_not_found' then
          raise;
        end if;
    end;
  end if;

  return public.get_formation_board(board_id_value);
end;
$$;

alter function public.save_coach_match_formation(
  text, text, text, text, text, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text
) owner to postgres;

revoke all on function public.save_coach_match_formation(
  text, text, text, text, text, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text
) from public, anon, service_role;

grant execute on function public.save_coach_match_formation(
  text, text, text, text, text, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text
) to authenticated;

comment on function public.save_coach_match_formation(
  text, text, text, text, text, jsonb, jsonb, text, integer, uuid, uuid, integer, boolean, text
) is 'Atomically saves a Coach Formation Board for one active Match and makes the current version coaches-only or visible to the Match audience.';

-- Return every current active publication for each named board and Match.
-- Rank before filtering withdrawn rows so an older publication cannot resurface.
drop function if exists public.get_parent_portal_match_formation_plans(uuid);

create function public.get_parent_portal_match_formation_plans(parent_link_id_value uuid)
returns table (
  match_day_id uuid,
  board_id uuid,
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
        partition by publication.match_day_id, publication.board_id
        order by publication.publication_number desc
      ) as publication_rank
    from public.formation_board_match_publications publication
    join parent_link link
      on link.club_id = publication.club_id
     and link.team_id = publication.team_id
  )
  select
    publication.match_day_id,
    publication.board_id,
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

alter function public.get_parent_portal_match_formation_plans(uuid) owner to postgres;
revoke all on function public.get_parent_portal_match_formation_plans(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_match_formation_plans(uuid) to authenticated;
