-- FP-V1-FORMATION-BOARD-MOBILE-SELECTION-PORTRAIT-27 rollback containment
-- Run only after the application has been rolled back to the recorded production commit.
-- The state-aware snapshot normalizer is intentionally retained because removing it
-- could silently coerce already saved Unplaced Players into bench Players.

begin;

drop trigger if exists formation_board_versions_canonical_portrait
on public.formation_board_versions;

drop function if exists app_private.canonicalize_new_formation_board_version();

do $$
begin
  if exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.formation_board_versions'::regclass
      and trigger_record.tgname = 'formation_board_versions_canonical_portrait'
      and not trigger_record.tgisinternal
  ) then
    raise exception using message = 'formation_board_portrait_rollback_verification_failed';
  end if;
end;
$$;

commit;
