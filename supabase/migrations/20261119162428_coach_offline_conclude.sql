-- Extend only the existing idempotent command handlers. Their authorization,
-- row locks, sequence checks and duplicate command handling remain unchanged.
do $migration$
declare
  signature text;
  definition text;
  old_clause text := $old$if action not in ('start','pause','hydration','half_time','resume','full_time')$old$;
  new_clause text := $new$if action not in ('start','pause','hydration','half_time','resume','full_time','conclude')$new$;
begin
  for signature in select unnest(array[
    'public.apply_coach_match_day_command(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)',
    'public.apply_coach_match_day_command_v2(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)'
  ]) loop
    definition := pg_catalog.pg_get_functiondef(signature::regprocedure);
    if position(old_clause in definition) = 0 then
      raise exception 'Expected Coach command handler was not found: %', signature;
    end if;
    execute replace(definition, old_clause, new_clause);
  end loop;
end;
$migration$;
