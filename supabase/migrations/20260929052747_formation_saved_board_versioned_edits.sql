-- Saved boards can receive a new immutable version through the existing
-- authorised editor RPCs. Historical versions remain unchanged.
drop trigger if exists formation_saved_version_lock on public.formation_board_versions;
drop trigger if exists formation_saved_board_lock on public.formation_boards;
drop function if exists app_private.guard_saved_formation_snapshot();

create or replace function app_private.formation_board_payload(target_board_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('board', to_jsonb(board), 'currentVersion', to_jsonb(version),
    'currentPublication', to_jsonb(publication), 'isLocked', false,
    'canDelete', app_private.formation_board_can_delete(auth.uid(), board.id))
  from public.formation_boards board
  join public.formation_board_versions version on version.id = board.current_version_id
  left join public.formation_board_publications publication on publication.id = board.current_publication_id
  where board.id = target_board_id;
$$;
