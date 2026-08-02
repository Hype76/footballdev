-- Prepared emergency containment procedure only.
-- Do not run during the forward release.
-- Use only after the application has been rolled back to the recorded Phase 1
-- production commit and Formation Board database access must be disabled.
-- This procedure is deliberately non-destructive and preserves every board,
-- immutable version, publication, export request, Resource record, and audit row.

begin;

revoke select on public.formation_board_presets from authenticated;
revoke select on public.formation_boards from authenticated;
revoke select on public.formation_board_versions from authenticated;
revoke select on public.formation_board_publications from authenticated;
revoke select on public.formation_board_export_requests from authenticated;

revoke execute on function public.current_user_can_view_formation_board(uuid) from authenticated;
revoke execute on function public.list_formation_boards(uuid, boolean) from authenticated;
revoke execute on function public.get_formation_board(uuid) from authenticated;
revoke execute on function public.create_formation_board(uuid, text, text, text, text, text, jsonb, jsonb, text, text, integer) from authenticated;
revoke execute on function public.save_formation_board_version(uuid, integer, text, text, text, jsonb, jsonb, text, text, text, integer) from authenticated;
revoke execute on function public.set_formation_board_visibility(uuid, integer, text) from authenticated;
revoke execute on function public.rename_formation_board(uuid, integer, text, text) from authenticated;
revoke execute on function public.duplicate_formation_board(uuid, text) from authenticated;
revoke execute on function public.archive_formation_board(uuid) from authenticated;
revoke execute on function public.restore_formation_board(uuid) from authenticated;
revoke execute on function public.delete_formation_board(uuid, text) from authenticated;
revoke execute on function public.list_formation_board_versions(uuid) from authenticated;
revoke execute on function public.restore_formation_board_version(uuid, uuid, integer) from authenticated;
revoke execute on function public.publish_formation_board_version(uuid, uuid, text, text, uuid) from authenticated;
revoke execute on function public.list_formation_board_publications(uuid) from authenticated;
revoke execute on function public.request_formation_board_export(uuid, uuid, text) from authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.formation_boards', 'select')
    or has_function_privilege('authenticated', 'public.get_formation_board(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.create_formation_board(uuid,text,text,text,text,text,jsonb,jsonb,text,text,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.publish_formation_board_version(uuid,uuid,text,text,uuid)', 'execute') then
    raise exception using
      errcode = '42501',
      message = 'formation_board_rollback_containment_verification_failed';
  end if;
end;
$$;

commit;
