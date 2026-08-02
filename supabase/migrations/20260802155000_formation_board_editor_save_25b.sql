-- FP-V1-FORMATION-BOARD-EDITOR-25B
-- Save editor metadata and its immutable layout version in one transaction.

create or replace function public.save_formation_board_editor(
  target_board_id uuid,
  expected_version_number integer,
  title_value text,
  description_value text,
  game_format_value text,
  preset_key_value text,
  pitch_orientation_value text,
  placements_value jsonb,
  bench_value jsonb,
  notes_value text,
  visibility_value text,
  version_reason_value text,
  registry_version_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_board jsonb;
begin
  saved_board := public.save_formation_board_version(
    target_board_id,
    expected_version_number,
    game_format_value,
    preset_key_value,
    pitch_orientation_value,
    placements_value,
    bench_value,
    notes_value,
    visibility_value,
    version_reason_value,
    registry_version_value
  );

  return public.rename_formation_board(
    target_board_id,
    expected_version_number + 1,
    title_value,
    description_value
  );
end;
$$;

revoke all on function public.save_formation_board_editor(
  uuid, integer, text, text, text, text, text, jsonb, jsonb, text, text, text, integer
) from public, anon;

grant execute on function public.save_formation_board_editor(
  uuid, integer, text, text, text, text, text, jsonb, jsonb, text, text, text, integer
) to authenticated;

comment on function public.save_formation_board_editor(
  uuid, integer, text, text, text, text, text, jsonb, jsonb, text, text, text, integer
) is 'Atomically saves Formation Board editor metadata and one immutable version with optimistic conflict protection.';
