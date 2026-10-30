-- Keep the deployed clock, scorer permissions, audit and conclusion behaviour.
-- A configured continuation is optional once a period has been completed.
do $migration$
declare
  definition text;
  marker text := E'  if normalized_action = ''full_time'' then\n    if match_row.match_conclusion_rule';
  replacement text := E'  if normalized_action = ''full_time''\n    and match_row.current_match_phase not in (''normal_time_complete'', ''extra_time_complete'') then\n    if match_row.match_conclusion_rule';
begin
  definition := pg_get_functiondef('public.set_match_day_timer_state(uuid,text)'::regprocedure);
  if strpos(definition, marker) = 0 then
    raise exception 'Expected match clock completion guard was not found.';
  end if;
  execute replace(definition, marker, replacement);
end;
$migration$;
