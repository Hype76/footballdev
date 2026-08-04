-- FP-V1-GAMEDAY-SQUAD-DECISIONS-RESEND-33 rollback containment
-- Run only after the application has been rolled back to the recorded production commit.
-- The strict recipient resolver and removal of automatic squad-decision email are
-- intentionally retained because reverting either would weaken communication safety.
-- The recipient-scoped queue idempotency index is also retained so a rollback
-- cannot reintroduce Parent B suppression.

begin;

drop function if exists public.set_match_day_player_squad_decision_v2(
  uuid,
  uuid,
  text,
  timestamptz
);

grant execute on function public.set_match_day_player_squad_decision(uuid, uuid, text)
to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.set_match_day_player_squad_decision_v2(uuid,uuid,text,timestamp with time zone)') is not null then
    raise exception using message = 'fp33_v2_rollback_verification_failed';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.set_match_day_player_squad_decision(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using message = 'fp33_legacy_execute_repair_failed';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.match_day_player_squad_decisions'::regclass
      and trigger_record.tgname = 'zz_match_day_selection_parent_email'
      and not trigger_record.tgisinternal
  ) then
    raise exception using message = 'fp33_automatic_email_trigger_restored_unsafely';
  end if;
end;
$$;

commit;
