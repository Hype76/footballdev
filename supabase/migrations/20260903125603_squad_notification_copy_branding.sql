-- Shorten future non-selected notifications without altering historical messages.
-- Keep the current recipient, revision, and permission checks unchanged.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.notify_match_day_squad_decision(uuid,uuid,uuid)'::regprocedure) into definition;
  if strpos(definition, ' this time. Thank you for your support.') = 0 then
    raise exception 'Expected squad notification copy was not found';
  end if;
  execute replace(definition, ' this time. Thank you for your support.', ' this time.');

  select pg_get_functiondef('public.claim_squad_notification_push(uuid)'::regprocedure) into definition;
  if strpos(definition, $$jsonb_build_object('match_day_id',decision.match_day_id)$$) = 0 then
    raise exception 'Expected squad notification claim result was not found';
  end if;
  execute replace(definition,
    $$jsonb_build_object('match_day_id',decision.match_day_id)$$,
    $$jsonb_build_object('match_day_id',decision.match_day_id,'decision_status',decision.status)$$);
end;
$migration$;
