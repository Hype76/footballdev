-- Parents can receive formation boards as explicitly shared PDF files.
-- Keep the existing match RPC signature for installed clients.
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
  bench jsonb,
  shirt_kit jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid, null::uuid, null::uuid, null::integer, null::text,
    null::timestamptz, null::text, null::text, null::text, null::jsonb,
    null::jsonb, null::jsonb
  where false;
$$;

create or replace function public.get_parent_portal_player_resources(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  title text,
  description text,
  share_description text,
  category text,
  resource_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  file_size_bytes integer,
  uploaded_by_profile_id uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  link_id uuid,
  assigned_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    item.id,
    item.club_id,
    item.team_id,
    link.linked_id as player_id,
    item.title,
    ''::text as description,
    coalesce(link.share_description, '') as share_description,
    item.category,
    case
      when external_link.resource_id is not null then 'external_link'
      else 'file'
    end as resource_type,
    ''::text as external_url,
    ''::text as storage_bucket,
    ''::text as storage_path,
    ''::text as original_filename,
    ''::text as mime_type,
    0::integer as file_size_bytes,
    null::uuid as uploaded_by_profile_id,
    ''::text as uploaded_by_name,
    ''::text as uploaded_by_email,
    null::timestamptz as archived_at,
    null::timestamptz as created_at,
    null::timestamptz as updated_at,
    link.id as link_id,
    link.assigned_at
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  join public.resource_library_links link
    on link.club_id = parent_link.club_id
   and (parent_link.team_id is null or parent_link.team_id = link.team_id)
   and link.team_id = player.team_id
   and link.linked_type = 'player'
   and link.linked_id = player.id
   and link.parent_visible is true
   and link.removed_at is null
  join public.resource_library_items item
    on item.id = link.resource_id
   and item.club_id = link.club_id
   and item.team_id = link.team_id
   and item.archived_at is null
  left join public.resource_library_external_links external_link
    on external_link.resource_id = item.id
   and external_link.club_id = item.club_id
   and external_link.team_id = item.team_id
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
    and coalesce(item.mime_type, '') <> 'application/vnd.footballplayer.formation-board+json'
    and not exists (select 1 from public.formation_board_publications publication where publication.resource_id = item.id);
$$;
