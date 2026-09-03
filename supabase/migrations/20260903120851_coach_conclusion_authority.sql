-- Accounts without a staff row produce NULL authority. Conclusion requires an explicit grant.
do $$
declare definition text; marker text := 'if normalized_action = ''conclude'' and not is_staff_actor then';
begin
  definition := pg_get_functiondef('public.set_match_day_timer_state(uuid,text)'::regprocedure);
  if position(marker in definition)=0 then raise exception 'Conclusion authority changed; review before applying.'; end if;
  execute replace(definition,marker,'if normalized_action = ''conclude'' and is_staff_actor is not true then');
end;
$$;
