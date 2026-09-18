-- Use the owned active Parent link, including Parent-only and staff-linked accounts.
-- Preserve match visibility, publication withdrawal and team isolation.
create or replace function public.get_parent_portal_match_formation_plans(parent_link_id_value uuid)
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
      and public.current_user_can_access_parent_link(link.id, link.player_id)
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
