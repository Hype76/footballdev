-- FP-V1-FORMATION-BOARD-FOUNDATION-25A
-- Server-authoritative Formation Board storage, versioning, audit, and Team Resource publication foundation.

create table public.formation_board_presets (
  registry_version integer not null,
  preset_key text not null,
  display_name text not null,
  game_format text not null,
  player_count smallint not null,
  slots jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  readiness_state text not null default 'ready',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (registry_version, preset_key),
  constraint formation_board_presets_registry_version_check check (registry_version > 0),
  constraint formation_board_presets_key_check check (preset_key ~ '^[a-z0-9-]+$'),
  constraint formation_board_presets_display_name_check check (char_length(btrim(display_name)) between 1 and 40),
  constraint formation_board_presets_game_format_check check (game_format in ('5v5', '7v7', '9v9', '11v11')),
  constraint formation_board_presets_player_count_check check (player_count in (5, 7, 9, 11)),
  constraint formation_board_presets_slots_type_check check (jsonb_typeof(slots) = 'array'),
  constraint formation_board_presets_slots_count_check check (
    (right(preset_key, 7) = '-custom' and jsonb_array_length(slots) = 0)
    or jsonb_array_length(slots) = player_count
  ),
  constraint formation_board_presets_readiness_check check (readiness_state in ('ready', 'disabled'))
);

insert into public.formation_board_presets (
  registry_version,
  preset_key,
  display_name,
  game_format,
  player_count,
  slots,
  sort_order,
  readiness_state
)
values
  (1, '5v5-1-2-1', '1-2-1', '5v5', 5, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.9},{"id":"def-left","group":"defender","x":0.28,"y":0.66},{"id":"def-right","group":"defender","x":0.72,"y":0.66},{"id":"mid","group":"midfielder","x":0.5,"y":0.46},{"id":"forward","group":"forward","x":0.5,"y":0.22}]'::jsonb, 10, 'ready'),
  (1, '5v5-1-1-2', '1-1-2', '5v5', 5, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.9},{"id":"def","group":"defender","x":0.5,"y":0.68},{"id":"mid","group":"midfielder","x":0.5,"y":0.48},{"id":"forward-left","group":"forward","x":0.3,"y":0.24},{"id":"forward-right","group":"forward","x":0.7,"y":0.24}]'::jsonb, 20, 'ready'),
  (1, '5v5-custom', 'Custom', '5v5', 5, '[]'::jsonb, 90, 'ready'),
  (1, '7v7-2-3-1', '2-3-1', '7v7', 7, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.92},{"id":"def-left","group":"defender","x":0.3,"y":0.72},{"id":"def-right","group":"defender","x":0.7,"y":0.72},{"id":"mid-left","group":"midfielder","x":0.22,"y":0.48},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.5},{"id":"mid-right","group":"midfielder","x":0.78,"y":0.48},{"id":"forward","group":"forward","x":0.5,"y":0.2}]'::jsonb, 10, 'ready'),
  (1, '7v7-3-2-1', '3-2-1', '7v7', 7, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.92},{"id":"def-left","group":"defender","x":0.2,"y":0.7},{"id":"def-centre","group":"defender","x":0.5,"y":0.75},{"id":"def-right","group":"defender","x":0.8,"y":0.7},{"id":"mid-left","group":"midfielder","x":0.34,"y":0.46},{"id":"mid-right","group":"midfielder","x":0.66,"y":0.46},{"id":"forward","group":"forward","x":0.5,"y":0.2}]'::jsonb, 20, 'ready'),
  (1, '7v7-2-2-2', '2-2-2', '7v7', 7, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.92},{"id":"def-left","group":"defender","x":0.3,"y":0.72},{"id":"def-right","group":"defender","x":0.7,"y":0.72},{"id":"mid-left","group":"midfielder","x":0.32,"y":0.48},{"id":"mid-right","group":"midfielder","x":0.68,"y":0.48},{"id":"forward-left","group":"forward","x":0.32,"y":0.22},{"id":"forward-right","group":"forward","x":0.68,"y":0.22}]'::jsonb, 30, 'ready'),
  (1, '7v7-custom', 'Custom', '7v7', 7, '[]'::jsonb, 90, 'ready'),
  (1, '9v9-3-3-2', '3-3-2', '9v9', 9, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.93},{"id":"def-left","group":"defender","x":0.2,"y":0.72},{"id":"def-centre","group":"defender","x":0.5,"y":0.76},{"id":"def-right","group":"defender","x":0.8,"y":0.72},{"id":"mid-left","group":"midfielder","x":0.22,"y":0.48},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.5},{"id":"mid-right","group":"midfielder","x":0.78,"y":0.48},{"id":"forward-left","group":"forward","x":0.36,"y":0.2},{"id":"forward-right","group":"forward","x":0.64,"y":0.2}]'::jsonb, 10, 'ready'),
  (1, '9v9-3-2-3', '3-2-3', '9v9', 9, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.93},{"id":"def-left","group":"defender","x":0.2,"y":0.74},{"id":"def-centre","group":"defender","x":0.5,"y":0.77},{"id":"def-right","group":"defender","x":0.8,"y":0.74},{"id":"mid-left","group":"midfielder","x":0.35,"y":0.5},{"id":"mid-right","group":"midfielder","x":0.65,"y":0.5},{"id":"forward-left","group":"forward","x":0.2,"y":0.22},{"id":"forward-centre","group":"forward","x":0.5,"y":0.18},{"id":"forward-right","group":"forward","x":0.8,"y":0.22}]'::jsonb, 20, 'ready'),
  (1, '9v9-2-3-3', '2-3-3', '9v9', 9, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.93},{"id":"def-left","group":"defender","x":0.32,"y":0.74},{"id":"def-right","group":"defender","x":0.68,"y":0.74},{"id":"mid-left","group":"midfielder","x":0.2,"y":0.5},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.52},{"id":"mid-right","group":"midfielder","x":0.8,"y":0.5},{"id":"forward-left","group":"forward","x":0.2,"y":0.22},{"id":"forward-centre","group":"forward","x":0.5,"y":0.18},{"id":"forward-right","group":"forward","x":0.8,"y":0.22}]'::jsonb, 30, 'ready'),
  (1, '9v9-custom', 'Custom', '9v9', 9, '[]'::jsonb, 90, 'ready'),
  (1, '11v11-4-4-2', '4-4-2', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.14,"y":0.75},{"id":"def-left-centre","group":"defender","x":0.38,"y":0.79},{"id":"def-right-centre","group":"defender","x":0.62,"y":0.79},{"id":"def-right","group":"defender","x":0.86,"y":0.75},{"id":"mid-left","group":"midfielder","x":0.14,"y":0.48},{"id":"mid-left-centre","group":"midfielder","x":0.38,"y":0.52},{"id":"mid-right-centre","group":"midfielder","x":0.62,"y":0.52},{"id":"mid-right","group":"midfielder","x":0.86,"y":0.48},{"id":"forward-left","group":"forward","x":0.36,"y":0.2},{"id":"forward-right","group":"forward","x":0.64,"y":0.2}]'::jsonb, 10, 'ready'),
  (1, '11v11-4-3-3', '4-3-3', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.14,"y":0.75},{"id":"def-left-centre","group":"defender","x":0.38,"y":0.79},{"id":"def-right-centre","group":"defender","x":0.62,"y":0.79},{"id":"def-right","group":"defender","x":0.86,"y":0.75},{"id":"mid-left","group":"midfielder","x":0.28,"y":0.5},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.54},{"id":"mid-right","group":"midfielder","x":0.72,"y":0.5},{"id":"forward-left","group":"forward","x":0.18,"y":0.2},{"id":"forward-centre","group":"forward","x":0.5,"y":0.16},{"id":"forward-right","group":"forward","x":0.82,"y":0.2}]'::jsonb, 20, 'ready'),
  (1, '11v11-4-2-3-1', '4-2-3-1', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.14,"y":0.76},{"id":"def-left-centre","group":"defender","x":0.38,"y":0.8},{"id":"def-right-centre","group":"defender","x":0.62,"y":0.8},{"id":"def-right","group":"defender","x":0.86,"y":0.76},{"id":"mid-hold-left","group":"midfielder","x":0.36,"y":0.59},{"id":"mid-hold-right","group":"midfielder","x":0.64,"y":0.59},{"id":"mid-left","group":"midfielder","x":0.2,"y":0.37},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.4},{"id":"mid-right","group":"midfielder","x":0.8,"y":0.37},{"id":"forward","group":"forward","x":0.5,"y":0.16}]'::jsonb, 30, 'ready'),
  (1, '11v11-3-5-2', '3-5-2', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.25,"y":0.76},{"id":"def-centre","group":"defender","x":0.5,"y":0.81},{"id":"def-right","group":"defender","x":0.75,"y":0.76},{"id":"mid-wing-left","group":"midfielder","x":0.1,"y":0.48},{"id":"mid-left","group":"midfielder","x":0.32,"y":0.54},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.48},{"id":"mid-right","group":"midfielder","x":0.68,"y":0.54},{"id":"mid-wing-right","group":"midfielder","x":0.9,"y":0.48},{"id":"forward-left","group":"forward","x":0.36,"y":0.2},{"id":"forward-right","group":"forward","x":0.64,"y":0.2}]'::jsonb, 40, 'ready'),
  (1, '11v11-3-4-3', '3-4-3', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.25,"y":0.76},{"id":"def-centre","group":"defender","x":0.5,"y":0.81},{"id":"def-right","group":"defender","x":0.75,"y":0.76},{"id":"mid-left","group":"midfielder","x":0.14,"y":0.5},{"id":"mid-left-centre","group":"midfielder","x":0.38,"y":0.54},{"id":"mid-right-centre","group":"midfielder","x":0.62,"y":0.54},{"id":"mid-right","group":"midfielder","x":0.86,"y":0.5},{"id":"forward-left","group":"forward","x":0.18,"y":0.2},{"id":"forward-centre","group":"forward","x":0.5,"y":0.16},{"id":"forward-right","group":"forward","x":0.82,"y":0.2}]'::jsonb, 50, 'ready'),
  (1, '11v11-4-1-4-1', '4-1-4-1', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.14,"y":0.76},{"id":"def-left-centre","group":"defender","x":0.38,"y":0.8},{"id":"def-right-centre","group":"defender","x":0.62,"y":0.8},{"id":"def-right","group":"defender","x":0.86,"y":0.76},{"id":"mid-hold","group":"midfielder","x":0.5,"y":0.62},{"id":"mid-left","group":"midfielder","x":0.14,"y":0.4},{"id":"mid-left-centre","group":"midfielder","x":0.38,"y":0.45},{"id":"mid-right-centre","group":"midfielder","x":0.62,"y":0.45},{"id":"mid-right","group":"midfielder","x":0.86,"y":0.4},{"id":"forward","group":"forward","x":0.5,"y":0.16}]'::jsonb, 60, 'ready'),
  (1, '11v11-4-5-1', '4-5-1', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-left","group":"defender","x":0.14,"y":0.76},{"id":"def-left-centre","group":"defender","x":0.38,"y":0.8},{"id":"def-right-centre","group":"defender","x":0.62,"y":0.8},{"id":"def-right","group":"defender","x":0.86,"y":0.76},{"id":"mid-left","group":"midfielder","x":0.1,"y":0.46},{"id":"mid-left-centre","group":"midfielder","x":0.3,"y":0.52},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.56},{"id":"mid-right-centre","group":"midfielder","x":0.7,"y":0.52},{"id":"mid-right","group":"midfielder","x":0.9,"y":0.46},{"id":"forward","group":"forward","x":0.5,"y":0.16}]'::jsonb, 70, 'ready'),
  (1, '11v11-5-3-2', '5-3-2', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-wing-left","group":"defender","x":0.08,"y":0.68},{"id":"def-left","group":"defender","x":0.28,"y":0.78},{"id":"def-centre","group":"defender","x":0.5,"y":0.82},{"id":"def-right","group":"defender","x":0.72,"y":0.78},{"id":"def-wing-right","group":"defender","x":0.92,"y":0.68},{"id":"mid-left","group":"midfielder","x":0.28,"y":0.48},{"id":"mid-centre","group":"midfielder","x":0.5,"y":0.53},{"id":"mid-right","group":"midfielder","x":0.72,"y":0.48},{"id":"forward-left","group":"forward","x":0.36,"y":0.2},{"id":"forward-right","group":"forward","x":0.64,"y":0.2}]'::jsonb, 80, 'ready'),
  (1, '11v11-5-4-1', '5-4-1', '11v11', 11, '[{"id":"gk","group":"goalkeeper","x":0.5,"y":0.94},{"id":"def-wing-left","group":"defender","x":0.08,"y":0.68},{"id":"def-left","group":"defender","x":0.28,"y":0.78},{"id":"def-centre","group":"defender","x":0.5,"y":0.82},{"id":"def-right","group":"defender","x":0.72,"y":0.78},{"id":"def-wing-right","group":"defender","x":0.92,"y":0.68},{"id":"mid-left","group":"midfielder","x":0.14,"y":0.46},{"id":"mid-left-centre","group":"midfielder","x":0.38,"y":0.52},{"id":"mid-right-centre","group":"midfielder","x":0.62,"y":0.52},{"id":"mid-right","group":"midfielder","x":0.86,"y":0.46},{"id":"forward","group":"forward","x":0.5,"y":0.16}]'::jsonb, 90, 'ready'),
  (1, '11v11-custom', 'Custom', '11v11', 11, '[]'::jsonb, 100, 'ready')
on conflict (registry_version, preset_key) do nothing;

create table public.formation_boards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  description text not null default '',
  game_format text not null,
  formation_preset_key text not null,
  preset_registry_version integer not null default 1,
  visibility_state text not null default 'draft',
  created_by_profile_id uuid not null references public.users(id),
  current_version_id uuid,
  current_version_number integer not null default 1,
  current_publication_id uuid,
  archived_at timestamptz,
  archived_by_profile_id uuid references public.users(id),
  deleted_at timestamptz,
  deleted_by_profile_id uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint formation_boards_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint formation_boards_description_check check (char_length(description) <= 1000),
  constraint formation_boards_game_format_check check (game_format in ('5v5', '7v7', '9v9', '11v11')),
  constraint formation_boards_visibility_check check (visibility_state in ('draft', 'shared')),
  constraint formation_boards_version_check check (current_version_number > 0),
  constraint formation_boards_preset_fkey foreign key (preset_registry_version, formation_preset_key)
    references public.formation_board_presets(registry_version, preset_key)
);

create unique index formation_boards_id_club_team_key on public.formation_boards(id, club_id, team_id);
create index formation_boards_team_updated_idx on public.formation_boards(team_id, updated_at desc) where deleted_at is null;
create index formation_boards_creator_idx on public.formation_boards(created_by_profile_id, updated_at desc) where deleted_at is null;

create table public.formation_board_versions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  version_number integer not null,
  game_format text not null,
  formation_preset_key text not null,
  preset_registry_version integer not null default 1,
  pitch_orientation text not null default 'portrait',
  placements jsonb not null default '[]'::jsonb,
  bench jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_by_profile_id uuid not null references public.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  version_reason text not null default 'save',
  source_version_id uuid references public.formation_board_versions(id) on delete set null,
  constraint formation_board_versions_board_fkey foreign key (board_id, club_id, team_id)
    references public.formation_boards(id, club_id, team_id) on delete cascade,
  constraint formation_board_versions_preset_fkey foreign key (preset_registry_version, formation_preset_key)
    references public.formation_board_presets(registry_version, preset_key),
  constraint formation_board_versions_number_check check (version_number > 0),
  constraint formation_board_versions_game_format_check check (game_format in ('5v5', '7v7', '9v9', '11v11')),
  constraint formation_board_versions_orientation_check check (pitch_orientation in ('portrait', 'landscape')),
  constraint formation_board_versions_placements_check check (jsonb_typeof(placements) = 'array'),
  constraint formation_board_versions_bench_check check (jsonb_typeof(bench) = 'array'),
  constraint formation_board_versions_notes_check check (char_length(notes) <= 2000),
  constraint formation_board_versions_reason_check check (char_length(btrim(version_reason)) between 1 and 200),
  unique (board_id, version_number),
  unique (id, board_id, club_id, team_id)
);

create index formation_board_versions_board_created_idx on public.formation_board_versions(board_id, version_number desc);

alter table public.formation_boards
  add constraint formation_boards_current_version_fkey
  foreign key (current_version_id, id, club_id, team_id)
  references public.formation_board_versions(id, board_id, club_id, team_id)
  deferrable initially deferred;

create table public.formation_board_publications (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  board_version_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  resource_id uuid not null references public.resource_library_items(id) on delete cascade,
  resource_category text not null,
  publication_number integer not null,
  publication_action text not null,
  previous_publication_id uuid references public.formation_board_publications(id) on delete set null,
  published_by_profile_id uuid not null references public.users(id),
  published_at timestamptz not null default timezone('utc', now()),
  thumbnail_bucket text,
  thumbnail_path text,
  publication_state text not null default 'published',
  constraint formation_board_publications_version_fkey
    foreign key (board_version_id, board_id, club_id, team_id)
    references public.formation_board_versions(id, board_id, club_id, team_id) on delete cascade,
  constraint formation_board_publications_category_check check (resource_category in ('general', 'training', 'match_day', 'development', 'admin')),
  constraint formation_board_publications_number_check check (publication_number > 0),
  constraint formation_board_publications_action_check check (publication_action in ('new_resource', 'update_resource')),
  constraint formation_board_publications_state_check check (publication_state in ('published', 'export_pending', 'export_failed')),
  constraint formation_board_publications_thumbnail_pair_check check (
    (thumbnail_bucket is null and thumbnail_path is null)
    or (thumbnail_bucket is not null and thumbnail_path is not null)
  ),
  unique (board_id, publication_number),
  unique (board_id, board_version_id, resource_id)
);

create index formation_board_publications_resource_idx on public.formation_board_publications(resource_id, publication_number desc);
create index formation_board_publications_board_idx on public.formation_board_publications(board_id, publication_number desc);

alter table public.formation_boards
  add constraint formation_boards_current_publication_fkey
  foreign key (current_publication_id)
  references public.formation_board_publications(id)
  on delete set null
  deferrable initially deferred;

create or replace function app_private.touch_formation_board_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger touch_formation_board_updated_at
before update on public.formation_boards
for each row execute function app_private.touch_formation_board_updated_at();

create or replace function app_private.reject_formation_board_immutable_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'formation_board_versions' then
      if not exists (
        select 1
        from public.formation_boards board
        where board.id = old.board_id
      ) then
        return old;
      end if;
    elsif tg_table_name = 'formation_board_publications' then
      if not exists (
        select 1
        from public.formation_board_versions version
        where version.id = old.board_version_id
      ) or not exists (
        select 1
        from public.resource_library_items resource
        where resource.id = old.resource_id
      ) then
        return old;
      end if;
    end if;
  end if;

  raise exception using errcode = '55000', message = 'formation_board_snapshot_immutable';
end;
$$;

create trigger formation_board_versions_immutable
before update or delete on public.formation_board_versions
for each row execute function app_private.reject_formation_board_immutable_change();

create trigger formation_board_publications_immutable
before update or delete on public.formation_board_publications
for each row execute function app_private.reject_formation_board_immutable_change();

create or replace function app_private.formation_board_team_role_rank(
  actor_id uuid,
  target_team_id uuid,
  target_club_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(assignment.role_rank), 0)::integer
  from public.team_staff assignment
  join public.users actor on actor.id = assignment.user_id
  join public.teams team on team.id = assignment.team_id
  where assignment.user_id = actor_id
    and assignment.team_id = target_team_id
    and actor.status = 'active'
    and team.status = 'active'
    and team.club_id = target_club_id
    and (
      actor.club_id = target_club_id
      or exists (
        select 1
        from public.user_club_memberships membership
        where membership.auth_user_id = actor_id
          and membership.club_id = target_club_id
      )
    )
    and assignment.role_key in ('head_manager', 'manager', 'coach', 'assistant_coach');
$$;

create or replace function app_private.formation_board_is_club_admin(
  actor_id uuid,
  target_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users actor
    where actor.id = actor_id
      and actor.status = 'active'
      and actor.club_id = target_club_id
      and actor.role = 'admin'
      and actor.role_rank >= 90
  ) or exists (
    select 1
    from public.user_club_memberships membership
    join public.users actor on actor.id = membership.auth_user_id
    where membership.auth_user_id = actor_id
      and membership.club_id = target_club_id
      and membership.role = 'admin'
      and membership.role_rank >= 90
      and actor.status = 'active'
  );
$$;

create or replace function app_private.formation_board_can_view(
  actor_id uuid,
  target_board_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.formation_boards board
    where board.id = target_board_id
      and board.deleted_at is null
      and (
        app_private.formation_board_is_club_admin(actor_id, board.club_id)
        or (
          app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) >= 20
          and (
            board.visibility_state = 'shared'
            or board.created_by_profile_id = actor_id
            or app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) >= 50
          )
        )
      )
  );
$$;

create or replace function app_private.formation_board_can_edit(
  actor_id uuid,
  target_board_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.formation_boards board
    where board.id = target_board_id
      and board.deleted_at is null
      and board.archived_at is null
      and (
        app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) >= 50
        or (
          app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) >= 30
          and (board.created_by_profile_id = actor_id or board.visibility_state = 'shared')
        )
      )
  );
$$;

create or replace function public.current_user_can_view_formation_board(target_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and app_private.formation_board_can_view(auth.uid(), target_board_id);
$$;

create or replace function app_private.formation_board_record_audit(
  actor_id uuid,
  target_club_id uuid,
  target_team_id uuid,
  action_value text,
  target_entity_id uuid,
  metadata_value jsonb default '{}'::jsonb,
  outcome_value text default 'success'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.users%rowtype;
  audit_id uuid;
  team_rank integer := 0;
begin
  select * into actor from public.users where id = actor_id and status = 'active';
  if not found then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  team_rank := app_private.formation_board_team_role_rank(actor_id, target_team_id, target_club_id);
  insert into public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    actor_name,
    actor_email,
    actor_role_label,
    actor_role_rank,
    event_category,
    severity,
    outcome,
    source
  ) values (
    target_club_id,
    actor_id,
    action_value,
    'formation_board',
    target_entity_id,
    coalesce(metadata_value, '{}'::jsonb) || jsonb_build_object('teamId', target_team_id),
    coalesce(actor.name, ''),
    actor.email,
    coalesce((select role_label from public.team_staff where team_id = target_team_id and user_id = actor_id limit 1), actor.role_label, actor.role),
    greatest(team_rank, case when actor.role = 'admin' then actor.role_rank else 0 end),
    'operational',
    case when outcome_value = 'denied' then 'warning' else 'info' end,
    outcome_value,
    'formation_board'
  ) returning id into audit_id;

  return audit_id;
end;
$$;

create or replace function app_private.formation_board_normalize_snapshot(
  target_club_id uuid,
  target_team_id uuid,
  game_format_value text,
  preset_key_value text,
  registry_version_value integer,
  placements_value jsonb,
  bench_value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  placement_limit integer;
  combined jsonb;
  item jsonb;
  player_uuid uuid;
  normalized_placements jsonb := '[]'::jsonb;
  normalized_bench jsonb := '[]'::jsonb;
  target_player public.players%rowtype;
  index_value integer := 0;
  display_number text;
begin
  if jsonb_typeof(coalesce(placements_value, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(bench_value, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'formation_board_snapshot_must_be_arrays';
  end if;

  select preset.player_count
  into placement_limit
  from public.formation_board_presets preset
  where preset.registry_version = registry_version_value
    and preset.preset_key = preset_key_value
    and preset.game_format = game_format_value
    and preset.readiness_state = 'ready';

  if placement_limit is null then
    raise exception using errcode = '22023', message = 'formation_board_preset_invalid';
  end if;

  if jsonb_array_length(coalesce(placements_value, '[]'::jsonb)) > placement_limit then
    raise exception using errcode = '22023', message = 'formation_board_pitch_player_limit_exceeded';
  end if;

  if jsonb_array_length(coalesce(bench_value, '[]'::jsonb)) > 50 then
    raise exception using errcode = '22023', message = 'formation_board_bench_limit_exceeded';
  end if;

  combined := coalesce(placements_value, '[]'::jsonb) || coalesce(bench_value, '[]'::jsonb);
  if exists (
    select 1
    from jsonb_array_elements(combined) entry
    group by entry->>'playerId'
    having entry->>'playerId' is null or count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'formation_board_player_duplicate';
  end if;

  for item in select value from jsonb_array_elements(coalesce(placements_value, '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'x') <> 'number'
      or jsonb_typeof(item->'y') <> 'number'
      or (item->>'x')::numeric < 0 or (item->>'x')::numeric > 1
      or (item->>'y')::numeric < 0 or (item->>'y')::numeric > 1 then
      raise exception using errcode = '22023', message = 'formation_board_placement_invalid';
    end if;

    player_uuid := (item->>'playerId')::uuid;
    select * into target_player
    from public.players player
    where player.id = player_uuid
      and player.club_id = target_club_id
      and player.team_id = target_team_id
      and coalesce(player.status, 'active') <> 'archived';

    if not found then
      raise exception using errcode = '42501', message = 'formation_board_player_out_of_scope';
    end if;

    display_number := coalesce(
      nullif(btrim(item->>'displayedShirtNumber'), ''),
      nullif(btrim(item->>'shirtNumber'), ''),
      nullif(btrim(target_player.shirt_number), ''),
      ''
    );
    if display_number <> '' and display_number !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'formation_board_shirt_number_invalid';
    end if;

    index_value := index_value + 1;
    normalized_placements := normalized_placements || jsonb_build_array(jsonb_build_object(
      'playerId', target_player.id,
      'displayName', coalesce(nullif(btrim(target_player.preferred_name), ''), nullif(btrim(concat_ws(' ', target_player.first_name, target_player.last_name)), ''), target_player.player_name),
      'shirtNumber', display_number,
      'x', (item->>'x')::numeric,
      'y', (item->>'y')::numeric,
      'slotId', left(coalesce(item->>'slotId', ''), 60),
      'positionGroup', case when item->>'positionGroup' in ('goalkeeper', 'defender', 'midfielder', 'forward') then item->>'positionGroup' else '' end,
      'state', 'pitch',
      'displayOrder', index_value
    ));
  end loop;

  index_value := 0;
  for item in select value from jsonb_array_elements(coalesce(bench_value, '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'playerId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'formation_board_bench_player_invalid';
    end if;

    player_uuid := (item->>'playerId')::uuid;
    select * into target_player
    from public.players player
    where player.id = player_uuid
      and player.club_id = target_club_id
      and player.team_id = target_team_id
      and coalesce(player.status, 'active') <> 'archived';

    if not found then
      raise exception using errcode = '42501', message = 'formation_board_player_out_of_scope';
    end if;

    display_number := coalesce(
      nullif(btrim(item->>'displayedShirtNumber'), ''),
      nullif(btrim(item->>'shirtNumber'), ''),
      nullif(btrim(target_player.shirt_number), ''),
      ''
    );
    if display_number <> '' and display_number !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'formation_board_shirt_number_invalid';
    end if;

    index_value := index_value + 1;
    normalized_bench := normalized_bench || jsonb_build_array(jsonb_build_object(
      'playerId', target_player.id,
      'displayName', coalesce(nullif(btrim(target_player.preferred_name), ''), nullif(btrim(concat_ws(' ', target_player.first_name, target_player.last_name)), ''), target_player.player_name),
      'shirtNumber', display_number,
      'state', 'bench',
      'displayOrder', index_value
    ));
  end loop;

  return jsonb_build_object('placements', normalized_placements, 'bench', normalized_bench);
end;
$$;

create or replace function app_private.formation_board_change_summary(
  previous_version public.formation_board_versions,
  next_game_format text,
  next_preset_key text,
  next_placements jsonb,
  next_bench jsonb
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with previous_all as (
    select value as item from jsonb_array_elements(previous_version.placements || previous_version.bench)
  ),
  next_all as (
    select value as item from jsonb_array_elements(next_placements || next_bench)
  ),
  added as (
    select coalesce(jsonb_agg(next_all.item->>'playerId' order by next_all.item->>'playerId'), '[]'::jsonb) as value
    from next_all
    where not exists (select 1 from previous_all where previous_all.item->>'playerId' = next_all.item->>'playerId')
  ),
  removed as (
    select coalesce(jsonb_agg(previous_all.item->>'playerId' order by previous_all.item->>'playerId'), '[]'::jsonb) as value
    from previous_all
    where not exists (select 1 from next_all where next_all.item->>'playerId' = previous_all.item->>'playerId')
  ),
  moved as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', next_item->>'playerId',
      'from', jsonb_build_object('x', previous_item->'x', 'y', previous_item->'y'),
      'to', jsonb_build_object('x', next_item->'x', 'y', next_item->'y')
    ) order by next_item->>'playerId'), '[]'::jsonb) as value
    from jsonb_array_elements(previous_version.placements) previous_item
    join jsonb_array_elements(next_placements) next_item on next_item->>'playerId' = previous_item->>'playerId'
    where previous_item->'x' is distinct from next_item->'x'
      or previous_item->'y' is distinct from next_item->'y'
  )
  select jsonb_build_object(
    'formationChange', jsonb_build_object(
      'fromGameFormat', previous_version.game_format,
      'toGameFormat', next_game_format,
      'fromPreset', previous_version.formation_preset_key,
      'toPreset', next_preset_key
    ),
    'playerAssignments', jsonb_build_object('added', added.value, 'removed', removed.value),
    'coordinateChanges', moved.value
  )
  from added, removed, moved;
$$;

create or replace function app_private.formation_board_payload(target_board_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'board', to_jsonb(board),
    'currentVersion', to_jsonb(version),
    'currentPublication', to_jsonb(publication)
  )
  from public.formation_boards board
  join public.formation_board_versions version on version.id = board.current_version_id
  left join public.formation_board_publications publication on publication.id = board.current_publication_id
  where board.id = target_board_id;
$$;

create or replace function public.list_formation_boards(
  target_team_id uuid,
  include_archived boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  result_value jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select * into target_team from public.teams where id = target_team_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_team_not_found';
  end if;

  if app_private.formation_board_team_role_rank(actor_id, target_team.id, target_team.club_id) < 20
    and not app_private.formation_board_is_club_admin(actor_id, target_team.club_id) then
    raise exception using errcode = '42501', message = 'formation_board_forbidden';
  end if;

  select coalesce(jsonb_agg(app_private.formation_board_payload(board.id) order by board.updated_at desc), '[]'::jsonb)
  into result_value
  from public.formation_boards board
  where board.team_id = target_team.id
    and board.club_id = target_team.club_id
    and board.deleted_at is null
    and (include_archived or board.archived_at is null)
    and app_private.formation_board_can_view(actor_id, board.id);
  perform app_private.formation_board_record_audit(actor_id, target_team.club_id, target_team.id, 'formation_board_listed', target_team.id, jsonb_build_object('includeArchived', include_archived, 'resultCount', jsonb_array_length(result_value)));
  return result_value;
end;
$$;

create or replace function public.get_formation_board(target_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null;
  if not found or not app_private.formation_board_can_view(actor_id, target_board_id) then
    raise exception using errcode = '42501', message = 'formation_board_forbidden';
  end if;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_read', board.id, jsonb_build_object('version', board.current_version_number));
  return app_private.formation_board_payload(target_board_id);
end;
$$;

create or replace function public.create_formation_board(
  target_team_id uuid,
  title_value text,
  description_value text,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text default 'portrait',
  placements_value jsonb default '[]'::jsonb,
  bench_value jsonb default '[]'::jsonb,
  notes_value text default '',
  visibility_value text default 'draft',
  registry_version_value integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  snapshot jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into target_team from public.teams where id = target_team_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_team_not_found';
  end if;
  if app_private.formation_board_team_role_rank(actor_id, target_team.id, target_team.club_id) < 30 then
    perform app_private.formation_board_record_audit(actor_id, target_team.club_id, target_team.id, 'formation_board_create_denied', target_team.id, jsonb_build_object('reason', 'role_ceiling'), 'denied');
    raise exception using errcode = '42501', message = 'formation_board_create_forbidden';
  end if;
  if char_length(btrim(coalesce(title_value, ''))) not between 1 and 120
    or char_length(coalesce(description_value, '')) > 1000
    or char_length(coalesce(notes_value, '')) > 2000
    or coalesce(pitch_orientation_value, '') not in ('portrait', 'landscape')
    or coalesce(visibility_value, '') not in ('draft', 'shared') then
    raise exception using errcode = '22023', message = 'formation_board_payload_invalid';
  end if;

  snapshot := app_private.formation_board_normalize_snapshot(
    target_team.club_id,
    target_team.id,
    game_format_value,
    preset_key_value,
    registry_version_value,
    placements_value,
    bench_value
  );

  insert into public.formation_boards (
    club_id, team_id, title, description, game_format, formation_preset_key,
    preset_registry_version, visibility_state, created_by_profile_id
  ) values (
    target_team.club_id, target_team.id, btrim(title_value), coalesce(description_value, ''),
    game_format_value, preset_key_value, registry_version_value, visibility_value, actor_id
  ) returning * into board;

  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, notes,
    created_by_profile_id, version_reason
  ) values (
    board.id, board.club_id, board.team_id, 1, game_format_value, preset_key_value,
    registry_version_value, pitch_orientation_value, snapshot->'placements', snapshot->'bench',
    coalesce(notes_value, ''), actor_id, 'create'
  ) returning * into version;

  update public.formation_boards
  set current_version_id = version.id
  where id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_created',
    board.id,
    jsonb_build_object(
      'newVersion', 1,
      'gameFormat', game_format_value,
      'presetKey', preset_key_value,
      'visibility', visibility_value,
      'pitchPlayerIds', (select coalesce(jsonb_agg(item->>'playerId'), '[]'::jsonb) from jsonb_array_elements(snapshot->'placements') item),
      'benchPlayerIds', (select coalesce(jsonb_agg(item->>'playerId'), '[]'::jsonb) from jsonb_array_elements(snapshot->'bench') item)
    )
  );

  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.save_formation_board_version(
  target_board_id uuid,
  expected_version_number integer,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  notes_value text default '',
  visibility_value text default null,
  version_reason_value text default 'save',
  registry_version_value integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  previous_version public.formation_board_versions%rowtype;
  next_version public.formation_board_versions%rowtype;
  snapshot jsonb;
  next_visibility text;
  summary jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_not_found';
  end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then
    perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_save_denied', board.id, jsonb_build_object('reason', 'authority'), 'denied');
    raise exception using errcode = '42501', message = 'formation_board_edit_forbidden';
  end if;
  if board.current_version_number <> expected_version_number then
    raise exception using errcode = '40001', message = 'formation_board_version_conflict', detail = jsonb_build_object('expectedVersion', expected_version_number, 'currentVersion', board.current_version_number)::text;
  end if;
  if char_length(coalesce(notes_value, '')) > 2000
    or char_length(btrim(coalesce(version_reason_value, ''))) not between 1 and 200
    or coalesce(pitch_orientation_value, '') not in ('portrait', 'landscape')
    or (visibility_value is not null and visibility_value not in ('draft', 'shared')) then
    raise exception using errcode = '22023', message = 'formation_board_payload_invalid';
  end if;

  snapshot := app_private.formation_board_normalize_snapshot(
    board.club_id,
    board.team_id,
    game_format_value,
    preset_key_value,
    registry_version_value,
    placements_value,
    bench_value
  );
  select * into previous_version from public.formation_board_versions where id = board.current_version_id;
  next_visibility := coalesce(visibility_value, board.visibility_state);
  summary := app_private.formation_board_change_summary(
    previous_version,
    game_format_value,
    preset_key_value,
    snapshot->'placements',
    snapshot->'bench'
  );

  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    board.id, board.club_id, board.team_id, board.current_version_number + 1,
    game_format_value, preset_key_value, registry_version_value, pitch_orientation_value,
    snapshot->'placements', snapshot->'bench', coalesce(notes_value, ''), actor_id,
    btrim(version_reason_value), previous_version.id
  ) returning * into next_version;

  update public.formation_boards
  set game_format = game_format_value,
      formation_preset_key = preset_key_value,
      preset_registry_version = registry_version_value,
      visibility_state = next_visibility,
      current_version_id = next_version.id,
      current_version_number = next_version.version_number
  where id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_version_saved',
    board.id,
    summary || jsonb_build_object(
      'previousVersion', previous_version.version_number,
      'newVersion', next_version.version_number,
      'previousVisibility', board.visibility_state,
      'newVisibility', next_visibility,
      'versionReason', btrim(version_reason_value)
    )
  );

  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.set_formation_board_visibility(
  target_board_id uuid,
  expected_version_number integer,
  visibility_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_edit_forbidden';
  end if;
  if board.current_version_number <> expected_version_number then
    raise exception using errcode = '40001', message = 'formation_board_version_conflict';
  end if;
  if visibility_value not in ('draft', 'shared') then
    raise exception using errcode = '22023', message = 'formation_board_visibility_invalid';
  end if;
  update public.formation_boards set visibility_state = visibility_value where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_visibility_changed', board.id, jsonb_build_object('from', board.visibility_state, 'to', visibility_value, 'version', board.current_version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.rename_formation_board(
  target_board_id uuid,
  expected_version_number integer,
  title_value text,
  description_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  next_description text;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then raise exception using errcode = '42501', message = 'formation_board_edit_forbidden'; end if;
  if board.current_version_number <> expected_version_number then raise exception using errcode = '40001', message = 'formation_board_version_conflict'; end if;
  next_description := coalesce(description_value, board.description);
  if char_length(btrim(coalesce(title_value, ''))) not between 1 and 120 or char_length(next_description) > 1000 then
    raise exception using errcode = '22023', message = 'formation_board_title_invalid';
  end if;
  update public.formation_boards set title = btrim(title_value), description = next_description where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_renamed', board.id, jsonb_build_object('previousTitle', board.title, 'newTitle', btrim(title_value), 'version', board.current_version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.duplicate_formation_board(
  source_board_id uuid,
  title_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  source_board public.formation_boards%rowtype;
  source_version public.formation_board_versions%rowtype;
  new_board public.formation_boards%rowtype;
  new_version public.formation_board_versions%rowtype;
  next_title text;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into source_board from public.formation_boards where id = source_board_id and deleted_at is null;
  if not found or not app_private.formation_board_can_view(actor_id, source_board_id) then raise exception using errcode = '42501', message = 'formation_board_forbidden'; end if;
  if app_private.formation_board_team_role_rank(actor_id, source_board.team_id, source_board.club_id) < 30 then raise exception using errcode = '42501', message = 'formation_board_create_forbidden'; end if;
  select * into source_version from public.formation_board_versions where id = source_board.current_version_id;
  next_title := coalesce(nullif(btrim(title_value), ''), left(source_board.title, 113) || ' copy');
  if char_length(next_title) > 120 then raise exception using errcode = '22023', message = 'formation_board_title_invalid'; end if;

  insert into public.formation_boards (
    club_id, team_id, title, description, game_format, formation_preset_key,
    preset_registry_version, visibility_state, created_by_profile_id
  ) values (
    source_board.club_id, source_board.team_id, next_title, source_board.description,
    source_version.game_format, source_version.formation_preset_key,
    source_version.preset_registry_version, 'draft', actor_id
  ) returning * into new_board;

  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    new_board.id, new_board.club_id, new_board.team_id, 1,
    source_version.game_format, source_version.formation_preset_key,
    source_version.preset_registry_version, source_version.pitch_orientation,
    source_version.placements, source_version.bench, source_version.notes,
    actor_id, 'duplicate', source_version.id
  ) returning * into new_version;

  update public.formation_boards set current_version_id = new_version.id where id = new_board.id;
  perform app_private.formation_board_record_audit(actor_id, new_board.club_id, new_board.team_id, 'formation_board_duplicated', new_board.id, jsonb_build_object('sourceBoardId', source_board.id, 'sourceVersion', source_version.version_number, 'newVersion', 1));
  return app_private.formation_board_payload(new_board.id);
end;
$$;

create or replace function public.archive_formation_board(target_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := auth.uid(); board public.formation_boards%rowtype; actor_rank integer;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  actor_rank := app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id);
  if actor_rank < 50 and not (actor_rank >= 30 and board.created_by_profile_id = actor_id) then raise exception using errcode = '42501', message = 'formation_board_archive_forbidden'; end if;
  update public.formation_boards set archived_at = timezone('utc', now()), archived_by_profile_id = actor_id where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_archived', board.id, jsonb_build_object('version', board.current_version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.restore_formation_board(target_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := auth.uid(); board public.formation_boards%rowtype; actor_rank integer;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  actor_rank := app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id);
  if actor_rank < 50 and not (actor_rank >= 30 and board.created_by_profile_id = actor_id) then raise exception using errcode = '42501', message = 'formation_board_restore_forbidden'; end if;
  update public.formation_boards set archived_at = null, archived_by_profile_id = null where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_restored', board.id, jsonb_build_object('version', board.current_version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create or replace function public.delete_formation_board(
  target_board_id uuid,
  confirm_title_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := auth.uid(); board public.formation_boards%rowtype;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) < 50 then raise exception using errcode = '42501', message = 'formation_board_delete_forbidden'; end if;
  if coalesce(confirm_title_value, '') <> board.title then raise exception using errcode = '22023', message = 'formation_board_delete_confirmation_failed'; end if;
  if exists (select 1 from public.formation_board_publications where board_id = board.id) then raise exception using errcode = '55000', message = 'formation_board_published_delete_forbidden'; end if;
  update public.formation_boards set deleted_at = timezone('utc', now()), deleted_by_profile_id = actor_id, archived_at = coalesce(archived_at, timezone('utc', now())), archived_by_profile_id = coalesce(archived_by_profile_id, actor_id) where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_deleted', board.id, jsonb_build_object('version', board.current_version_number));
  return jsonb_build_object('success', true, 'boardId', board.id, 'deleted', true);
end;
$$;

create or replace function public.list_formation_board_versions(target_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  result_value jsonb;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null;
  if not found or not app_private.formation_board_can_view(actor_id, target_board_id) then raise exception using errcode = '42501', message = 'formation_board_forbidden'; end if;
  select coalesce(jsonb_agg(to_jsonb(version) order by version.version_number desc), '[]'::jsonb)
  into result_value
  from public.formation_board_versions version
  where version.board_id = target_board_id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_versions_listed', board.id, jsonb_build_object('resultCount', jsonb_array_length(result_value)));
  return result_value;
end;
$$;

create or replace function public.restore_formation_board_version(
  target_board_id uuid,
  target_version_id uuid,
  expected_version_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  source_version public.formation_board_versions%rowtype;
  next_version public.formation_board_versions%rowtype;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_edit(actor_id, board.id) then raise exception using errcode = '42501', message = 'formation_board_edit_forbidden'; end if;
  if board.current_version_number <> expected_version_number then raise exception using errcode = '40001', message = 'formation_board_version_conflict'; end if;
  select * into source_version from public.formation_board_versions where id = target_version_id and board_id = board.id;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_version_not_found'; end if;
  insert into public.formation_board_versions (
    board_id, club_id, team_id, version_number, game_format, formation_preset_key,
    preset_registry_version, pitch_orientation, placements, bench, notes,
    created_by_profile_id, version_reason, source_version_id
  ) values (
    board.id, board.club_id, board.team_id, board.current_version_number + 1,
    source_version.game_format, source_version.formation_preset_key, source_version.preset_registry_version,
    source_version.pitch_orientation, source_version.placements, source_version.bench, source_version.notes,
    actor_id, 'restore version ' || source_version.version_number::text, source_version.id
  ) returning * into next_version;
  update public.formation_boards set current_version_id = next_version.id, current_version_number = next_version.version_number, game_format = next_version.game_format, formation_preset_key = next_version.formation_preset_key, preset_registry_version = next_version.preset_registry_version where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_version_restored', board.id, jsonb_build_object('previousVersion', board.current_version_number, 'restoredFromVersion', source_version.version_number, 'newVersion', next_version.version_number));
  return app_private.formation_board_payload(board.id);
end;
$$;

create table public.formation_board_export_requests (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  board_version_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  requested_by_profile_id uuid not null references public.users(id),
  export_format text not null,
  export_state text not null default 'pending',
  output_bucket text,
  output_path text,
  failure_code text,
  requested_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint formation_board_export_requests_version_fkey
    foreign key (board_version_id, board_id, club_id, team_id)
    references public.formation_board_versions(id, board_id, club_id, team_id) on delete cascade,
  constraint formation_board_export_requests_format_check check (export_format in ('png', 'pdf')),
  constraint formation_board_export_requests_state_check check (export_state in ('pending', 'ready', 'failed')),
  constraint formation_board_export_requests_output_pair_check check (
    (output_bucket is null and output_path is null)
    or (output_bucket is not null and output_path is not null)
  ),
  constraint formation_board_export_requests_completion_check check (
    (export_state = 'pending' and completed_at is null)
    or (export_state in ('ready', 'failed') and completed_at is not null)
  )
);

create index formation_board_export_requests_board_idx
on public.formation_board_export_requests(board_id, requested_at desc);

create or replace function public.publish_formation_board_version(
  target_board_id uuid,
  target_version_id uuid,
  category_value text,
  publication_action_value text default 'new_resource',
  target_resource_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor public.users%rowtype;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  prior_publication public.formation_board_publications%rowtype;
  resource public.resource_library_items%rowtype;
  publication public.formation_board_publications%rowtype;
  publication_number_value integer;
  protected_url text;
  synthetic_storage_path text;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board
  from public.formation_boards
  where id = target_board_id and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_not_found';
  end if;
  if board.archived_at is not null then
    raise exception using errcode = '55000', message = 'formation_board_archived_publish_forbidden';
  end if;
  if app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) < 30 then
    raise exception using errcode = '42501', message = 'formation_board_publish_forbidden';
  end if;
  if category_value not in ('general', 'training', 'match_day', 'development', 'admin') then
    raise exception using errcode = '22023', message = 'formation_board_resource_category_invalid';
  end if;
  if publication_action_value not in ('new_resource', 'update_resource') then
    raise exception using errcode = '22023', message = 'formation_board_publication_action_invalid';
  end if;

  select * into version
  from public.formation_board_versions
  where id = target_version_id
    and board_id = board.id
    and club_id = board.club_id
    and team_id = board.team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_version_not_found';
  end if;

  if exists (
    select 1
    from public.formation_board_publications existing
    where existing.board_id = board.id
      and existing.board_version_id = version.id
      and (
        publication_action_value = 'new_resource'
        or existing.resource_id = target_resource_id
      )
  ) then
    raise exception using errcode = '23505', message = 'formation_board_duplicate_publication';
  end if;

  select * into actor from public.users where id = actor_id and status = 'active';
  if not found then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  publication_number_value := coalesce((
    select max(existing.publication_number)
    from public.formation_board_publications existing
    where existing.board_id = board.id
  ), 0) + 1;
  protected_url := 'https://footballplayer.online/formation-boards/' || board.id::text || '?version=' || version.id::text;

  if publication_action_value = 'new_resource' then
    if target_resource_id is not null then
      raise exception using errcode = '22023', message = 'formation_board_new_resource_id_forbidden';
    end if;
    resource.id := gen_random_uuid();
    synthetic_storage_path := board.club_id::text || '/' || board.team_id::text || '/formation-boards/' || resource.id::text;
    insert into public.resource_library_items (
      id,
      club_id,
      team_id,
      title,
      description,
      category,
      storage_bucket,
      storage_path,
      original_filename,
      mime_type,
      file_size_bytes,
      uploaded_by_profile_id,
      uploaded_by_name,
      uploaded_by_email
    ) values (
      resource.id,
      board.club_id,
      board.team_id,
      board.title,
      board.description,
      category_value,
      'resource-library',
      synthetic_storage_path,
      'formation-board-' || board.id::text || '-v' || version.version_number::text,
      'text/plain',
      1,
      actor_id,
      coalesce(actor.name, ''),
      actor.email
    ) returning * into resource;

    insert into public.resource_library_external_links (
      resource_id,
      club_id,
      team_id,
      external_url,
      created_by_profile_id
    ) values (
      resource.id,
      board.club_id,
      board.team_id,
      protected_url,
      actor_id
    );
  else
    if target_resource_id is null then
      raise exception using errcode = '22023', message = 'formation_board_update_resource_required';
    end if;
    select * into prior_publication
    from public.formation_board_publications existing
    where existing.board_id = board.id
      and existing.resource_id = target_resource_id
      and existing.club_id = board.club_id
      and existing.team_id = board.team_id
    order by existing.publication_number desc
    limit 1;
    if not found then
      raise exception using errcode = '42501', message = 'formation_board_resource_not_linked';
    end if;
    select * into resource
    from public.resource_library_items item
    where item.id = target_resource_id
      and item.club_id = board.club_id
      and item.team_id = board.team_id
      and item.archived_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'formation_board_resource_not_found';
    end if;
    update public.resource_library_items
    set title = board.title,
        description = board.description,
        category = category_value,
        updated_at = timezone('utc', now())
    where id = resource.id
    returning * into resource;
    update public.resource_library_external_links
    set external_url = protected_url,
        updated_at = timezone('utc', now())
    where resource_id = resource.id
      and club_id = board.club_id
      and team_id = board.team_id;
  end if;

  insert into public.formation_board_publications (
    board_id,
    board_version_id,
    club_id,
    team_id,
    resource_id,
    resource_category,
    publication_number,
    publication_action,
    previous_publication_id,
    published_by_profile_id
  ) values (
    board.id,
    version.id,
    board.club_id,
    board.team_id,
    resource.id,
    category_value,
    publication_number_value,
    publication_action_value,
    case when publication_action_value = 'update_resource' then prior_publication.id else board.current_publication_id end,
    actor_id
  ) returning * into publication;

  update public.formation_boards
  set current_publication_id = publication.id
  where id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_published',
    board.id,
    jsonb_build_object(
      'boardVersionId', version.id,
      'boardVersion', version.version_number,
      'publicationId', publication.id,
      'publicationNumber', publication.publication_number,
      'publicationAction', publication.publication_action,
      'resourceId', resource.id,
      'resourceCategory', category_value,
      'notificationSent', false,
      'emailSent', false,
      'parentVisible', false
    )
  );

  return jsonb_build_object(
    'publication', to_jsonb(publication),
    'resource', to_jsonb(resource),
    'protectedUrl', protected_url
  );
end;
$$;

create or replace function public.list_formation_board_publications(target_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  result_value jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null;
  if not found or not app_private.formation_board_can_view(actor_id, target_board_id) then
    raise exception using errcode = '42501', message = 'formation_board_forbidden';
  end if;
  select coalesce(jsonb_agg(to_jsonb(publication) order by publication.publication_number desc), '[]'::jsonb)
  into result_value
  from public.formation_board_publications publication
  where publication.board_id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_publications_listed', board.id, jsonb_build_object('resultCount', jsonb_array_length(result_value)));
  return result_value;
end;
$$;

create or replace function public.request_formation_board_export(
  target_board_id uuid,
  target_version_id uuid,
  export_format_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  request_record public.formation_board_export_requests%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null;
  if not found or app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) < 30 then
    raise exception using errcode = '42501', message = 'formation_board_export_forbidden';
  end if;
  if export_format_value not in ('png', 'pdf') then
    raise exception using errcode = '22023', message = 'formation_board_export_format_invalid';
  end if;
  select * into version
  from public.formation_board_versions
  where id = target_version_id
    and board_id = board.id
    and club_id = board.club_id
    and team_id = board.team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_version_not_found';
  end if;
  insert into public.formation_board_export_requests (
    board_id,
    board_version_id,
    club_id,
    team_id,
    requested_by_profile_id,
    export_format
  ) values (
    board.id,
    version.id,
    board.club_id,
    board.team_id,
    actor_id,
    export_format_value
  ) returning * into request_record;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id, 'formation_board_export_requested', board.id, jsonb_build_object('requestId', request_record.id, 'boardVersionId', version.id, 'boardVersion', version.version_number, 'format', export_format_value));
  return jsonb_build_object('request', to_jsonb(request_record), 'snapshot', to_jsonb(version));
end;
$$;

alter table public.formation_board_presets enable row level security;
alter table public.formation_boards enable row level security;
alter table public.formation_board_versions enable row level security;
alter table public.formation_board_publications enable row level security;
alter table public.formation_board_export_requests enable row level security;

create policy formation_board_presets_select_authenticated
on public.formation_board_presets
for select
to authenticated
using (readiness_state = 'ready');

create policy formation_boards_select_authorised
on public.formation_boards
for select
to authenticated
using (public.current_user_can_view_formation_board(id));

create policy formation_board_versions_select_authorised
on public.formation_board_versions
for select
to authenticated
using (public.current_user_can_view_formation_board(board_id));

create policy formation_board_publications_select_authorised
on public.formation_board_publications
for select
to authenticated
using (public.current_user_can_view_formation_board(board_id));

create policy formation_board_export_requests_select_authorised
on public.formation_board_export_requests
for select
to authenticated
using (
  requested_by_profile_id = auth.uid()
  and public.current_user_can_view_formation_board(board_id)
);

revoke all on public.formation_board_presets from public, anon, authenticated;
revoke all on public.formation_boards from public, anon, authenticated;
revoke all on public.formation_board_versions from public, anon, authenticated;
revoke all on public.formation_board_publications from public, anon, authenticated;
revoke all on public.formation_board_export_requests from public, anon, authenticated;

grant select on public.formation_board_presets to authenticated;
grant select on public.formation_boards to authenticated;
grant select on public.formation_board_versions to authenticated;
grant select on public.formation_board_publications to authenticated;
grant select on public.formation_board_export_requests to authenticated;
grant all on public.formation_board_presets to service_role;
grant all on public.formation_boards to service_role;
grant all on public.formation_board_versions to service_role;
grant all on public.formation_board_publications to service_role;
grant all on public.formation_board_export_requests to service_role;

revoke all on function public.current_user_can_view_formation_board(uuid) from public, anon;
revoke all on function public.list_formation_boards(uuid, boolean) from public, anon;
revoke all on function public.get_formation_board(uuid) from public, anon;
revoke all on function public.create_formation_board(uuid, text, text, text, text, text, jsonb, jsonb, text, text, integer) from public, anon;
revoke all on function public.save_formation_board_version(uuid, integer, text, text, text, jsonb, jsonb, text, text, text, integer) from public, anon;
revoke all on function public.set_formation_board_visibility(uuid, integer, text) from public, anon;
revoke all on function public.rename_formation_board(uuid, integer, text, text) from public, anon;
revoke all on function public.duplicate_formation_board(uuid, text) from public, anon;
revoke all on function public.archive_formation_board(uuid) from public, anon;
revoke all on function public.restore_formation_board(uuid) from public, anon;
revoke all on function public.delete_formation_board(uuid, text) from public, anon;
revoke all on function public.list_formation_board_versions(uuid) from public, anon;
revoke all on function public.restore_formation_board_version(uuid, uuid, integer) from public, anon;
revoke all on function public.publish_formation_board_version(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.list_formation_board_publications(uuid) from public, anon;
revoke all on function public.request_formation_board_export(uuid, uuid, text) from public, anon;

grant execute on function public.current_user_can_view_formation_board(uuid) to authenticated, service_role;
grant execute on function public.list_formation_boards(uuid, boolean) to authenticated, service_role;
grant execute on function public.get_formation_board(uuid) to authenticated, service_role;
grant execute on function public.create_formation_board(uuid, text, text, text, text, text, jsonb, jsonb, text, text, integer) to authenticated, service_role;
grant execute on function public.save_formation_board_version(uuid, integer, text, text, text, jsonb, jsonb, text, text, text, integer) to authenticated, service_role;
grant execute on function public.set_formation_board_visibility(uuid, integer, text) to authenticated, service_role;
grant execute on function public.rename_formation_board(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.duplicate_formation_board(uuid, text) to authenticated, service_role;
grant execute on function public.archive_formation_board(uuid) to authenticated, service_role;
grant execute on function public.restore_formation_board(uuid) to authenticated, service_role;
grant execute on function public.delete_formation_board(uuid, text) to authenticated, service_role;
grant execute on function public.list_formation_board_versions(uuid) to authenticated, service_role;
grant execute on function public.restore_formation_board_version(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.publish_formation_board_version(uuid, uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.list_formation_board_publications(uuid) to authenticated, service_role;
grant execute on function public.request_formation_board_export(uuid, uuid, text) to authenticated, service_role;

revoke all on function app_private.touch_formation_board_updated_at() from public, anon, authenticated;
revoke all on function app_private.reject_formation_board_immutable_change() from public, anon, authenticated;
revoke all on function app_private.formation_board_team_role_rank(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.formation_board_is_club_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.formation_board_can_view(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.formation_board_can_edit(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.formation_board_record_audit(uuid, uuid, uuid, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function app_private.formation_board_normalize_snapshot(uuid, uuid, text, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.formation_board_change_summary(public.formation_board_versions, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.formation_board_payload(uuid) from public, anon, authenticated;

comment on table public.formation_board_presets is 'Versioned server-authoritative starting coordinates for Formation Board presets.';
comment on table public.formation_boards is 'Current Team-scoped Formation Board metadata and current immutable version pointer.';
comment on table public.formation_board_versions is 'Immutable complete Formation Board snapshots.';
comment on table public.formation_board_publications is 'Immutable links between board versions and Team Resource records.';
comment on table public.formation_board_export_requests is 'Authenticated Team-scoped evidence for PNG and PDF export requests.';
