-- The single-player writer is deliberately private to authorised RPC wrappers.
-- Preserve its caller identity checks, team scope and lifecycle validation.
alter function public.set_match_day_squad_decisions_batch(uuid, uuid, jsonb)
  security definer;
alter function public.set_match_day_squad_decisions_batch(uuid, uuid, jsonb)
  set search_path = '';
revoke all on function public.set_match_day_squad_decisions_batch(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_match_day_squad_decisions_batch(uuid, uuid, jsonb) to authenticated, service_role;
