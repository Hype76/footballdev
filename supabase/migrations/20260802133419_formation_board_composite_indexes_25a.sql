-- FP-V1-FORMATION-BOARD-FOUNDATION-25A
-- Cover the complete column order of the three composite version foreign keys.

drop index if exists public.formation_board_exports_version_idx;
create index formation_board_exports_version_idx
  on public.formation_board_export_requests (board_version_id, board_id, club_id, team_id);

drop index if exists public.formation_board_publications_version_idx;
create index formation_board_publications_version_idx
  on public.formation_board_publications (board_version_id, board_id, club_id, team_id);

drop index if exists public.formation_boards_current_version_idx;
create index formation_boards_current_version_idx
  on public.formation_boards (current_version_id, id, club_id, team_id);
