-- FP-V1-FORMATION-BOARD-FOUNDATION-25A
-- Cover Formation Board foreign keys and avoid per-row auth lookup in export-request RLS.

create index if not exists formation_board_exports_requester_idx
  on public.formation_board_export_requests (requested_by_profile_id);

create index if not exists formation_board_exports_version_idx
  on public.formation_board_export_requests (board_version_id);

create index if not exists formation_board_publications_previous_idx
  on public.formation_board_publications (previous_publication_id);

create index if not exists formation_board_publications_publisher_idx
  on public.formation_board_publications (published_by_profile_id);

create index if not exists formation_board_publications_version_idx
  on public.formation_board_publications (board_version_id);

create index if not exists formation_board_versions_board_scope_idx
  on public.formation_board_versions (board_id, club_id, team_id);

create index if not exists formation_board_versions_creator_idx
  on public.formation_board_versions (created_by_profile_id);

create index if not exists formation_board_versions_preset_idx
  on public.formation_board_versions (preset_registry_version, formation_preset_key);

create index if not exists formation_board_versions_source_idx
  on public.formation_board_versions (source_version_id);

create index if not exists formation_boards_archived_by_idx
  on public.formation_boards (archived_by_profile_id);

create index if not exists formation_boards_club_idx
  on public.formation_boards (club_id);

create index if not exists formation_boards_current_publication_idx
  on public.formation_boards (current_publication_id);

create index if not exists formation_boards_current_version_idx
  on public.formation_boards (current_version_id);

create index if not exists formation_boards_deleted_by_idx
  on public.formation_boards (deleted_by_profile_id);

create index if not exists formation_boards_preset_idx
  on public.formation_boards (preset_registry_version, formation_preset_key);

drop policy if exists formation_board_export_requests_select_authorised
  on public.formation_board_export_requests;

create policy formation_board_export_requests_select_authorised
on public.formation_board_export_requests
for select
to authenticated
using (
  requested_by_profile_id = (select auth.uid())
  and public.current_user_can_view_formation_board(board_id)
);
