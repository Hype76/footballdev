-- One transaction for the complete draft. Existing player rules remain authoritative.
create or replace function public.set_match_day_squad_decisions_batch(
  match_day_id_value uuid, active_team_id_value uuid, decisions_value jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  detail jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Login is required.'; end if;
  if jsonb_typeof(decisions_value) is distinct from 'array' then
    raise exception 'Provide a list of squad decisions.';
  end if;
  if jsonb_array_length(decisions_value) < 1 or jsonb_array_length(decisions_value) > 100 then
    raise exception 'Choose between 1 and 100 squad decisions.';
  end if;
  if exists(select 1 from jsonb_array_elements(decisions_value) d
    where jsonb_typeof(d) is distinct from 'object' or nullif(d->>'playerId','') is null
      or coalesce(d->>'decision','') not in ('selected','not_selected','waiting','undecided')) then
    raise exception 'Each squad decision must include a player and valid choice.';
  end if;
  if (select count(distinct (d->>'playerId')::uuid) from jsonb_array_elements(decisions_value) d)
    <> jsonb_array_length(decisions_value) then raise exception 'Include each player once.'; end if;
  -- Validate scope even when all requested choices already match existing values.
  detail := public.get_staff_match_day_detail(match_day_id_value, active_team_id_value);
  if detail->>'id' is distinct from match_day_id_value::text then
    raise exception 'This match day is not linked to your active Team.';
  end if;
  -- Consistent lock order prevents overlapping batch requests from deadlocking.
  for item in select d from jsonb_array_elements(decisions_value) d order by (d->>'playerId')::uuid loop
    perform public.set_match_day_player_squad_decision_v2(
      match_day_id_value, (item->>'playerId')::uuid, item->>'decision',
      nullif(item->>'expectedDecidedAt','')::timestamptz);
    -- Recheck authority and lifecycle on the idempotent v2 return path too.
    perform public.set_match_day_player_squad_decision(match_day_id_value, (item->>'playerId')::uuid, item->>'decision');
  end loop;
  return public.get_staff_match_day_detail(match_day_id_value, active_team_id_value);
end;
$$;
revoke all on function public.set_match_day_squad_decisions_batch(uuid,uuid,jsonb) from public, anon;
grant execute on function public.set_match_day_squad_decisions_batch(uuid,uuid,jsonb) to authenticated, service_role;
