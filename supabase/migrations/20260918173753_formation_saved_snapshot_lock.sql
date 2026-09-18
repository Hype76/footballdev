-- A saved board is a permanent snapshot. New lineups require new boards.
create or replace function app_private.guard_saved_formation_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'formation_board_versions' then
    perform 1 from public.formation_boards where id = new.board_id and current_version_id is not null for update;
    if found then
      raise exception using errcode = '55000', message = 'formation_board_snapshot_locked';
    end if;
  elsif old.current_version_id is not null and (
    row(new.title, new.description, new.game_format, new.formation_preset_key, new.preset_registry_version,
      new.club_id, new.team_id, new.created_by_profile_id, new.current_version_id, new.current_version_number, new.visibility_state)
    is distinct from
    row(old.title, old.description, old.game_format, old.formation_preset_key, old.preset_registry_version,
      old.club_id, old.team_id, old.created_by_profile_id, old.current_version_id, old.current_version_number, old.visibility_state)
    or (old.linked_match_day_id is not null and new.linked_match_day_id is distinct from old.linked_match_day_id)
  ) then
    raise exception using errcode = '55000', message = 'formation_board_snapshot_locked';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_saved_formation_snapshot() from public, anon, authenticated, service_role;
create trigger formation_saved_version_lock before insert on public.formation_board_versions
for each row execute function app_private.guard_saved_formation_snapshot();
create trigger formation_saved_board_lock before update on public.formation_boards
for each row execute function app_private.guard_saved_formation_snapshot();

create or replace function app_private.formation_board_can_delete(actor_id uuid, target_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select actor_id is not null and exists (
    select 1 from public.formation_boards board
    where board.id = target_board_id and board.deleted_at is null
      and app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) >= 30
      and (board.created_by_profile_id = actor_id or board.visibility_state = 'shared')
  );
$$;
revoke all on function app_private.formation_board_can_delete(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app_private.formation_board_payload(target_board_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('board', to_jsonb(board), 'currentVersion', to_jsonb(version),
    'currentPublication', to_jsonb(publication), 'isLocked', true,
    'canDelete', app_private.formation_board_can_delete(auth.uid(), board.id))
  from public.formation_boards board
  join public.formation_board_versions version on version.id = board.current_version_id
  left join public.formation_board_publications publication on publication.id = board.current_publication_id
  where board.id = target_board_id;
$$;

create or replace function public.delete_formation_board(target_board_id uuid, confirm_title_value text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); board public.formation_boards%rowtype;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'formation_board_auth_required'; end if;
  select * into board from public.formation_boards where id = target_board_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'formation_board_not_found'; end if;
  if not app_private.formation_board_can_delete(actor_id, board.id) then
    raise exception using errcode = '42501', message = 'formation_board_delete_forbidden';
  end if;
  if coalesce(confirm_title_value, '') <> board.title then
    raise exception using errcode = '22023', message = 'formation_board_delete_confirmation_failed';
  end if;
  update public.formation_board_match_publications set withdrawn_at = now(), withdrawn_by_profile_id = actor_id
  where board_id = board.id and withdrawn_at is null;
  update public.resource_library_items item set archived_at = now(), archived_by_profile_id = actor_id
  where item.archived_at is null and exists (
    select 1 from public.formation_board_publications publication
    where publication.board_id = board.id and publication.resource_id = item.id
  );
  update public.formation_boards set deleted_at = now(), deleted_by_profile_id = actor_id,
    archived_at = coalesce(archived_at, now()), archived_by_profile_id = coalesce(archived_by_profile_id, actor_id)
  where id = board.id;
  perform app_private.formation_board_record_audit(actor_id, board.club_id, board.team_id,
    'formation_board_deleted', board.id, jsonb_build_object('version', board.current_version_number));
  return jsonb_build_object('success', true, 'boardId', board.id, 'deleted', true);
end;
$$;
revoke all on function public.delete_formation_board(uuid, text) from public, anon, service_role;
grant execute on function public.delete_formation_board(uuid, text) to authenticated;
